import WebSocket, { WebSocketServer } from 'ws'; // Import WebSocketServer
import { v4 as uuidv4 } from 'uuid';
import * as dotenv from 'dotenv';
import { IncomingMessage } from 'http';

// Import types
import { WebSocketClient, SignalingMessage, MessageType } from './types';

// Import modules
import { initializeDatabase, closeDbPool } from './db';
import { handleWebSocketMessage } from './messageHandler';
import { sendWsMessage, broadcast } from './wsUtils';

// Load environment variables
dotenv.config();

// --- Server Configuration ---
const PORT = parseInt(process.env.WEBSOCKET_PORT || '8080', 10);

// --- Global State ---
const clients = new Map<string, WebSocketClient>();
let heartbeatInterval: NodeJS.Timeout | null = null;
let wss: WebSocketServer | null = null; // Declare wss here, initially null

// --- WebSocket Server Setup ---
console.log('Initializing signaling server...');

initializeDatabase().then(() => {
    // *** Assign the created instance to the top-level wss variable ***
    wss = new WebSocketServer({ port: PORT });
    console.log(`Signaling server started on ws://localhost:${PORT}`);

    wss.on('connection', (ws: WebSocketClient, req: IncomingMessage) => {
        // Initial setup for new connection
        ws.clientId = uuidv4();
        ws.isAlive = true;
        const clientIp = req.socket.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
        console.log(`Client connected (clientId: ${ws.clientId}, IP: ${clientIp})`);

        // Heartbeat listener
        ws.on('pong', () => {
            ws.isAlive = true;
        });

        // Message listener: Parse and delegate to handler
        ws.on('message', async (messageBuffer: Buffer) => {
            let parsedMessage: SignalingMessage;
            try {
                parsedMessage = JSON.parse(messageBuffer.toString());
                if (!parsedMessage.type) throw new Error('Message type is missing');
                console.log(`Received from ${ws.userId || ws.clientId}:`, parsedMessage.type, parsedMessage.target ? `-> ${parsedMessage.target}`: '');

                // Delegate processing to the message handler
                // Pass the actual 'clients' map
                await handleWebSocketMessage(ws, parsedMessage, clients);

            } catch (e: any) {
                console.error(`Failed to parse or handle message from ${ws.userId || ws.clientId}:`, messageBuffer.toString(), e.message);
                sendWsMessage(ws, { type: MessageType.Error, payload: { message: `Invalid message format or processing error: ${e.message}` } });
            }
        });

        // Close listener: Clean up client map and notify others
        ws.on('close', (code, reason) => {
            const userId = ws.userId;
            const clientId = ws.clientId; // Use temp ID if login never happened
            console.log(`Client disconnected: ${userId || clientId}, Code: ${code}, Reason: ${reason.toString()}`);
            if (userId && clients.has(userId)) {
                clients.delete(userId); // Remove client from map
                // Notify other users
                broadcast(clients, { type: MessageType.UserLeft, payload: { userId: userId } }, ws);
                console.log(`User ${userId} removed from active clients. Total clients: ${clients.size}`);
            } else {
                 console.log(`Unauthenticated client ${clientId} disconnected.`);
            }
        });

        // Error listener: Log error and potentially clean up
        ws.on('error', (error) => {
            const userId = ws.userId;
            const clientId = ws.clientId;
            console.error(`WebSocket error for ${userId || clientId}:`, error);
            if (userId && clients.has(userId)) {
                clients.delete(userId);
                broadcast(clients, { type: MessageType.UserLeft, payload: { userId: userId } }, ws);
                 console.log(`User ${userId} removed due to error. Total clients: ${clients.size}`);
            }
            if (ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
                 ws.terminate();
            }
        });
    }); // End wss.on('connection')

    // Heartbeat interval
    heartbeatInterval = setInterval(() => {
        // Use 'wss.clients' provided by the 'ws' library to iterate
        // This is safer than iterating our potentially out-of-sync 'clients' map for pings
        wss?.clients.forEach((wsInstance) => {
            // Cast to our extended type to access custom properties
            const client = wsInstance as WebSocketClient;
            if (!client.isAlive) {
                console.log(`Heartbeat failed for ${client.userId || client.clientId}. Terminating.`);
                client.terminate();
                return;
            }
            client.isAlive = false;
            client.ping();
        });
    }, 30000); // Check every 30 seconds


    // Listener for when the server itself closes
    wss.on('close', () => {
        console.log('WebSocket server instance has closed.');
        // Stop the heartbeat interval ONLY when the server instance closes
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        // Closing the DB pool is handled in gracefulShutdown after wss.close completes
    });

    console.log('Signaling server setup complete and listening.');

}).catch(err => {
    console.error("FATAL: Failed to initialize database. Server cannot start.", err);
    process.exit(1); // Exit if DB initialization fails
});

// --- Graceful Shutdown Logic ---
async function gracefulShutdown(signal: string) {
    console.log(`Received ${signal}. Shutting down gracefully...`);

    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
        console.log('Heartbeat interval stopped.');
    }

    // Check if the server instance exists
    if (!wss) {
        console.log('WebSocket server instance was not created. Closing DB pool.');
        await closeDbPool();
        process.exit(0);
        return;
    }

    // 1. Close all client connections
    // wss.clients is a Set of all active connections managed by ws library
    console.log(`Terminating ${wss.clients.size} active client connections...`);
    wss.clients.forEach(client => {
        client.terminate(); // Forcefully close connections
    });
    clients.clear(); // Clear our user map as well

    // 2. Close the WebSocket server itself
    console.log('Closing WebSocket server...');
    wss.close(async (err) => { // Use the callback here
        if (err) {
            console.error('Error closing WebSocket server:', err);
        } else {
            console.log('WebSocket server closed successfully.');
        }

        // 3. Close the database pool AFTER the server is closed
        await closeDbPool();

        // 4. Exit the process
        console.log('Shutdown complete.');
        process.exit(err ? 1 : 0); // Exit with error code if server closing failed
    });

    // Force exit after a timeout if graceful shutdown hangs
    setTimeout(() => {
        console.error('Graceful shutdown timed out. Forcing exit.');
        process.exit(1);
    }, 10000); // 10 seconds timeout
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
