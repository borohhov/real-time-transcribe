import WebSocket from 'ws';
import { PassThrough } from 'stream';
import { TargetLangCode } from './supportedLanguageCodes';
import { INACTIVITY_TIMEOUT_MS } from './transcriptionMessage';
import { CustomWebSocket } from './customWebSocket';

export class Stream {
  audioSource: CustomWebSocket;
  subscribers: Set<WebSocket> = new Set();
  isTranscribing: boolean = true;
  audioStream: PassThrough | null = null;
  abortController: AbortController | null = null;
  language?: TargetLangCode;
  inactivityTimeout: any;
  isPaused: boolean = false;
  listenerCleanup: (() => void) | null = null;
  createdAt: number;

  // Add these properties
  transcriptionPassThrough: PassThrough | null = null;
  transcriptionProcess: Promise<void> | null = null;

  constructor(audioSource: CustomWebSocket) {
    this.audioSource = audioSource;
    this.inactivityTimeout = INACTIVITY_TIMEOUT_MS;
    this.createdAt = Date.now();
  }
}

export const streams = new Map<string, Stream>();
