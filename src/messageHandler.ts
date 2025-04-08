import WebSocket from 'ws';
import { WebSocketClient, SignalingMessage, MessageType, LoginPayload, RegisterPushPayload } from './types';
import { saveOrUpdatePushToken, getPushToken } from './db';
import { sendWsMessage } from './wsUtils'; // Use the utility for sending messages
import { logger } from './logger';

/**
 * Handles incoming WebSocket messages based on their type.
 * @param ws The WebSocket client connection sending the message.
 * @param message The parsed SignalingMessage object.
 * @param clients Map of all currently connected clients.
 */
export async function handleWebSocketMessage(
    ws: WebSocketClient,
    message: SignalingMessage,
    clients: Map<string, WebSocketClient>
): Promise<void> {
    try {
        switch (message.type) {
            // 1. Client Identification (Login)
            case MessageType.Login: {
                const payload = message.payload as LoginPayload;
                const userId  = payload?.userId;

                if (!userId || typeof userId !== 'string' || userId.trim() === '') {
                    sendWsMessage(ws, { type: MessageType.Error, payload: { message: 'Valid User ID is required for login' }, originalType: message.type });
                    return;
                }

                if (clients.has(userId)) {
                    logger.log({ level: 'warn', message: `Login attempt failed: User ID ${userId} is already logged in.` });
                    sendWsMessage(ws, { type: MessageType.Error, payload: { message: `User ID ${userId} is already taken/logged in.` }, originalType: message.type });
                    ws.terminate(); // Close the new connection trying to use the same ID
                    return;
                }

                const oldClientId = ws.clientId;
                delete ws.clientId; // Remove temporary ID

                ws.userId = userId;
                clients.set(userId, ws); // Add to the centrally managed map
                logger.log({ level: 'info', message: `Client logged in: ${userId} (was ${oldClientId})` });

                sendWsMessage(ws, { type: MessageType.LoginSuccess, payload: { userId: userId } });
                // Optional: broadcast(clients, { type: MessageType.UserJoined, payload: { userId } }, ws);
                break;
            }

            // 2. Client Registers Push Token
            case MessageType.RegisterPush: {
                if (!ws.userId) {
                    sendWsMessage(ws, { type: MessageType.Error, payload: { message: 'Must be logged in to register push token' }, originalType: message.type });
                    return;
                }

                const payload   = message.payload as RegisterPushPayload;
                const pushToken = payload?.pushToken;

                if (!pushToken || typeof pushToken !== 'string' || pushToken.trim() === '') {
                    sendWsMessage(ws, { type: MessageType.Error, payload: { message: 'Valid push token is required' }, originalType: message.type });
                    return;
                }

                try {
                    await saveOrUpdatePushToken(ws.userId, pushToken);
                    sendWsMessage(ws, { type: MessageType.PushRegistered, payload: { userId: ws.userId } });
                } catch (dbError) {
                    logger.log({ level: 'error', message: `Handler Error: Failed to save push token for ${ws.userId}: ${dbError}` });
                    sendWsMessage(ws, { type: MessageType.Error, payload: { message: 'Failed to save push token on server' }, originalType: message.type });
                }
                break;
            }

            // 3. Relaying WebRTC/Custom Messages
            case MessageType.Offer:
            case MessageType.Answer:
            case MessageType.Candidate:
            case MessageType.MessageRequest: {
                const targetId = message.target;
                const senderId = ws.userId;

                if (!senderId) {
                    sendWsMessage(ws, { type: MessageType.Error, payload: { message: 'Cannot send message: Not logged in.' }, originalType: message.type });
                    return;
                }
                if (!targetId || typeof targetId !== 'string') {
                    sendWsMessage(ws, { type: MessageType.Error, payload: { message: 'Target user ID is required.' }, originalType: message.type });
                    return;
                }
                if (!message.payload) {
                    sendWsMessage(ws, { type: MessageType.Error, payload: { message: 'Payload is missing.' }, originalType: message.type });
                    return;
                }

                const targetClient = clients.get(targetId);

                if (targetClient && targetClient.readyState === WebSocket.OPEN) {
                    // Target online: Forward message
                    const messageToSend: SignalingMessage = {
                        ...message,
                        sender: senderId // Ensure sender ID is attached
                    };
                    logger.log({ level: 'info', message: `Forwarding ${message.type} from ${senderId} to ${targetId}` });
                    sendWsMessage(targetClient, messageToSend);
                } else {
                    // Target offline: Attempt push notification logic
                    logger.log({ level: 'info', message: `Target client ${targetId} offline. Checking for push token.` });
                    try {
                        const pushToken = await getPushToken(targetId);
                        if (pushToken) {
                            logger.log({ level: 'info', message: `Retrieved push token for offline user ${targetId}. (Push sending NOT implemented)` });
                            // **** PLACEHOLDER: Trigger actual push notification sending here ****
                            // await sendPushNotification(pushToken, { /* ... notification content ... */ });
                            sendWsMessage(ws, { type: MessageType.Info, payload: `User ${targetId} is offline. Push notification required.` });
                        } else {
                            logger.log({ level: 'info', message: `No push token found for offline user ${targetId}.` });
                            sendWsMessage(ws, { type: MessageType.Error, payload: { message: `User ${targetId} is offline and no push token is registered.` }, originalType: message.type });
                        }
                    } catch (dbError) {
                        logger.log({ level: 'error', message: `Handler Error: DB error checking push token for ${targetId}: ${dbError}` });
                        sendWsMessage(ws, { type: MessageType.Error, payload: { message: `Server error checking offline status for ${targetId}.` }, originalType: message.type });
                    }
                }
                break;
            }

            // Default case for unknown message types
            default:
                logger.log({ level: 'warn', message: `Unknown message type received: ${message.type}` });
                sendWsMessage(ws, { type: MessageType.Error, payload: { message: `Unknown message type: ${message.type}` } });
                break;
        }
    } catch (error) {
        // Generic error handler for the switch statement
        logger.log({ level: 'error', message: `Error processing message type ${message.type} for ${ws.userId || ws.clientId}: ${error}` });
        sendWsMessage(ws, { type: MessageType.Error, payload: { message: `Server error handling message type ${message.type}` }, originalType: message.type });
    }
}
