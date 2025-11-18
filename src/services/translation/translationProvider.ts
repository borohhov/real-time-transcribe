export interface TranslationMetadata {
    streamID?: string;
    sessionID?: string;
    traceID?: string;
}

export interface TranslationProvider {
    translate(
        text: string,
        sourceLang: string,
        targetLang: string,
        context?: string,
        metadata?: TranslationMetadata
    ): Promise<string>;
}
