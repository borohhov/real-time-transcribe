import { TranslationMetadata, TranslationProvider } from "./translationProvider";
import { OpenAIProvider } from "./openai/openaiProvider";

export class TranslationService {
  private provider: TranslationProvider;

  constructor() {
    this.provider = new OpenAIProvider();
  }

  async translate(
    text: string,
    sourceLang: string,
    targetLang: string,
    context?: string,
    metadata?: TranslationMetadata
  ): Promise<string> {
    return this.provider.translate(text, sourceLang, targetLang, context, metadata);
  }
}
