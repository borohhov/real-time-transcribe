import { SupportedSourceLanguageCode, SupportedTargetLanguageCode } from "./supportedLanguageCodes";


export interface TranscriptionMessage {
    type: 'transcript';
    sourceLanguageCode: SupportedSourceLanguageCode;
    destinationLanguageCode: SupportedTargetLanguageCode;
    transcript: string;
    isPartial: boolean;
    streamID: string;
  }