import WebSocket from 'ws';
import { WebSocketClient, SignalingMessage } from './types';

/**
 * Safely sends a JSON message to a single WebSocket client.
 * @param ws The WebSocket client connection.
 * @param message The SignalingMessage object to send.
 */
export function sendWsMessage(ws: WebSocketClient, message: SignalingMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
        try {
            ws.send(JSON.stringify(message));
        } catch (error) {
            console.error(`Failed to send message to ${ws.userId || ws.clientId}:`, error);
        }
    } else {
        console.warn(`Attempted to send message to ${ws.userId || ws.clientId} but socket was not open (state: ${ws.readyState})`);
    }
}

/**
 * Broadcasts a message to all connected clients, optionally excluding the sender.
 * @param clients Map of currently connected clients (userId -> WebSocketClient).
 * @param message The SignalingMessage object to broadcast.
 * @param senderWs The WebSocket client who sent the original message (optional, to exclude).
 */
export function broadcast(clients: Map<string, WebSocketClient>, message: SignalingMessage, senderWs?: WebSocketClient): void {
    console.log(`Broadcasting message type ${message.type} to ${clients.size} client(s)`);
    clients.forEach((client) => {
        if (client !== senderWs) { // Ensure we don't send back to sender unless intended
            sendWsMessage(client, message);
        }
    });
}
