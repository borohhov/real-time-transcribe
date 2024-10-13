import WebSocket from 'ws';
import { PassThrough } from 'stream';
import { TargetLangCode } from './supportedLanguageCodes';
import { INACTIVITY_TIMEOUT_MS } from './transcriptionMessage';

export class Stream {
  audioSource: WebSocket;
  subscribers: Set<WebSocket> = new Set();
  isTranscribing: boolean = true;
  audioStream: PassThrough | null = null;
  abortController: AbortController | null = null;
  language?: TargetLangCode;
  inactivityTimeout: any;
  isPaused: boolean = false;
  listenerCleanup: (() => void) | null = null;

  // Add these properties
  transcriptionPassThrough: PassThrough | null = null;
  transcriptionProcess: Promise<void> | null = null;

  constructor(audioSource: WebSocket) {
    this.audioSource = audioSource;
    this.inactivityTimeout = INACTIVITY_TIMEOUT_MS
  }
}

export const streams = new Map<string, Stream>();
