import { TranslationProvider } from "../translationProvider";
import axios from "axios";
import { captureAiGenerationEvent } from "../../analytics/posthogClient";
import { TranslationMetadata, TranslationProvider } from "../translationProvider";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";

type OpenAIChatCompletionResponse = {
  id: string;
  model: string;
  choices: { message: { content: string } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

export class OpenAIProvider implements TranslationProvider {
  async translate(
    text: string,
    sourceLang: string = 'en-US',
    targetLang: string = 'et-EE',
    context?: string,
    metadata?: TranslationMetadata
  ): Promise<string> {
    const additionalInstruction = 'Never output any explanation,question, error message or reasoning, only the translation. You are translating spiritual talks, so if there is a word you do not understand, try to find a sensible word from the indian philosophy. Remove duplicate words, repetitions, and phrases like \'um\' and similar';
    let prompt = `Translate the following text from ${sourceLang} to ${targetLang}. ${additionalInstruction}`;
    if (context) {
      prompt = `Translate the following text from ${sourceLang} to ${targetLang}. You are translating live subtitles that get updated every few seconds. Try not to change previously translated chunks. Previous chunk: ${context} ${additionalInstruction}. `;
    }
    try {
      const response = await axios.post<OpenAIChatCompletionResponse>(
        OPENAI_API_URL,
        {
          model: DEFAULT_MODEL,
          messages: [
            {
              role: "system",
              content: prompt,
            },
            {
              role: "user",
              content: text,
            },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      const translatedText = response.data.choices[0].message.content.trim();
      return translatedText;
    } catch (error) {
      captureAiGenerationEvent({
        distinctId,
        provider: 'openai',
        model: DEFAULT_MODEL,
        task: 'translation',
        prompt,
        input: text,
        context,
        latencyMs: Date.now() - requestStartedAt,
        metadata: {
          sourceLanguage: sourceLang,
          targetLanguage: targetLang,
          streamID: metadata?.streamID,
        },
        status: 'failed',
        errorName: error instanceof Error ? error.name : 'Error',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      console.error("Error translating text with OpenAI:", error);
      throw new Error("Translation failed");
    }
  }
}