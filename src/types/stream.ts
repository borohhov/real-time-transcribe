import WebSocket from 'ws';
import { PassThrough } from 'stream';
import { TargetLangCode } from '../common/types/supportedLanguageCodes';

export class Stream {
  audioSource: WebSocket;
  subscribers: Set<WebSocket> = new Set();
  isTranscribing: boolean = true;
  audioStream: PassThrough | null = null;
  abortController: AbortController | null = null;
  language?: TargetLangCode;
  isPaused: boolean = false;
  listenerCleanup: (() => void) | null = null;

  // Add these properties
  transcriptionPassThrough: PassThrough | null = null;
  transcriptionProcess: Promise<void> | null = null;

  constructor(audioSource: WebSocket) {
    this.audioSource = audioSource;
  }
}

export const streams = new Map<string, Stream>();
