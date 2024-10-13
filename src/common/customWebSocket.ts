// src/types/CustomWebSocket.ts
import WebSocket from 'ws';

export interface CustomWebSocket extends WebSocket {
  initialized?: boolean;
  streamID?: string;
  isAudioSource?: boolean;
}
