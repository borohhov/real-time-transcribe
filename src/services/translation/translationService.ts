import { TranslationProvider } from "./translationProvider";
import { OpenAIProvider } from "./openai/openaiProvider";

export class TranslationService {
  private provider: TranslationProvider;

  constructor() {
    this.provider = new OpenAIProvider();
  }

  async translate(text: string, sourceLang: string, targetLang: string, context?: string): Promise<string> {
    return this.provider.translate(text, sourceLang, targetLang, context);
  }
}