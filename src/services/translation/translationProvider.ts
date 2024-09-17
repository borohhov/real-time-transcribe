export interface TranslationProvider {
    translate(text: string, sourceLang: string, targetLang: string, context?: string): Promise<string>;
  }