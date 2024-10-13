import { SourceLangCode, TargetLangCode } from "./supportedLanguageCodes";


export interface TranscriptionMessage {
    type: 'transcript';
    sourceLanguageCode: SourceLangCode;
    destinationLanguageCode: TargetLangCode;
    transcript: string;
    isPartial: boolean;
    streamID: string;
  }

export const SILENT_AUDIO = Buffer.from([0xF8, 0xFF, 0xFE]); // Represents a tiny amount of silence in WebRTC Opus format
export const INACTIVITY_TIMEOUT_MS = 14000; // Timeout before sending silence or handling inactivity
