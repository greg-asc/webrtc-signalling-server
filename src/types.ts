import WebSocket from 'ws';

// Extend WebSocket type to include our custom properties
export interface WebSocketClient extends WebSocket {
    clientId?:  string;  // Temporary ID before login
    userId?:    string;  // User ID after successful login
    isAlive?:   boolean; // For heartbeat/ping mechanism
}

// Define the structure for messages exchanged via WebSocket
export interface SignalingMessage {
    type:           MessageType;
    payload:        any;
    target?:        string;
    sender?:        string;
    originalType?:  MessageType; // Optional field to include original message type in error responses
}

// Define specific payload types (examples)
export interface LoginPayload {
    userId: string;
}

export interface RegisterPushPayload {
    // userId should be implicitly known from the connection (ws.userId)
    pushToken: string;
}

export interface ErrorPayload {
    message: string;
}

export interface RelayPayload {
    [key: string]: any; // Payload for offer, answer, candidate
}

// Define allowed message types
export enum MessageType {
    Login          = 'login',
    LoginSuccess   = 'login_success',
    RegisterPush   = 'register_push',
    PushRegistered = 'push_registered',
    Offer          = 'offer',
    Answer         = 'answer',
    Candidate      = 'candidate',
    MessageRequest = 'message_request', // Example custom message
    UserLeft       = 'user_left',
    Error          = 'error',
    Info           = 'info'
}
