// src/models/stream.ts
import WebSocket from 'ws';
import { PassThrough } from 'stream';

export class Stream {
  audioSource: WebSocket;
  subscribers: Set<WebSocket> = new Set();
  isTranscribing: boolean = true;
  audioStream: PassThrough | null = null;
  abortController: AbortController | null = null;
  listenerCleanup: (() => void) | null = null;

  constructor(audioSource: WebSocket) {
    this.audioSource = audioSource;
  }
}

export const streams = new Map<string, Stream>();
