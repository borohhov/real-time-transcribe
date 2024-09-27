import { SourceLangCode, TargetLangCode } from "./supportedLanguageCodes";


export interface TranscriptionMessage {
    type: 'transcript';
    sourceLanguageCode: SourceLangCode;
    destinationLanguageCode: TargetLangCode;
    transcript: string;
    isPartial: boolean;
    streamID: string;
  }