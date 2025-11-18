import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import {
  AiCostProperties,
  AiGenerationUsage,
  AiMessage,
  captureAiGenerationEvent,
} from "../../analytics/posthogClient";
import { TranslationMetadata, TranslationProvider } from "../translationProvider";

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const OPENAI_CHAT_COMPLETIONS_URL = `${OPENAI_BASE_URL}/chat/completions`;
const DEFAULT_MODEL = "gpt-5-nano";

interface OpenAIChatCompletionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAIChatCompletionResponse {
  id: string;
  model: string;
  choices: { message: { role: "assistant" | "system" | "user"; content: string } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  created?: number;
}

interface OpenAIPricing {
  inputTokenPrice: number;
  outputTokenPrice: number;
  requestPrice?: number;
}

const TOKENS_PER_UNIT =  1_000_000;

const OPENAI_PRICING: Record<string, OpenAIPricing> = {
  "gpt-4o-mini": {
    inputTokenPrice: 0.4 / TOKENS_PER_UNIT,
    outputTokenPrice: 1.6 / TOKENS_PER_UNIT,
  },
  "gpt-5-nano": {
    inputTokenPrice: 0.05 / TOKENS_PER_UNIT,
    outputTokenPrice: 0.4 / TOKENS_PER_UNIT,
  }
};

const mapUsage = (usage?: OpenAIChatCompletionResponse["usage"]): AiGenerationUsage | undefined => {
  if (!usage) return undefined;
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
};

const calculateCosts = (
  usage: AiGenerationUsage | undefined,
  model: string
): AiCostProperties | undefined => {
  if (!usage) return undefined;
  const pricing = OPENAI_PRICING[model];
  if (!pricing) return undefined;

  const inputCostUsd =
    usage.promptTokens !== undefined ? usage.promptTokens * pricing.inputTokenPrice : undefined;
  const outputCostUsd =
    usage.completionTokens !== undefined ? usage.completionTokens * pricing.outputTokenPrice : undefined;
  const requestCostUsd = pricing.requestPrice;

  const anyCost =
    typeof inputCostUsd === "number" ||
    typeof outputCostUsd === "number" ||
    typeof requestCostUsd === "number";

  if (!anyCost) {
    return {
      inputTokenPrice: pricing.inputTokenPrice,
      outputTokenPrice: pricing.outputTokenPrice,
      requestPrice: pricing.requestPrice,
    };
  }

  return {
    inputCostUsd,
    outputCostUsd,
    requestCostUsd,
    totalCostUsd: (inputCostUsd ?? 0) + (outputCostUsd ?? 0) + (requestCostUsd ?? 0),
    inputTokenPrice: pricing.inputTokenPrice,
    outputTokenPrice: pricing.outputTokenPrice,
    requestPrice: pricing.requestPrice,
  };
};

const toAnalyticsMessages = (messages: OpenAIChatCompletionMessage[]): AiMessage[] =>
  messages.map((message) => ({
    role: message.role,
    content: [
      {
        type: "text",
        text: message.content,
      },
    ],
  }));

const toAnalyticsChoices = (
  response: OpenAIChatCompletionResponse
): AiMessage[] | undefined => {
  if (!response.choices?.length) {
    return undefined;
  }

  return response.choices.map((choice) => ({
    role: choice.message.role,
    content: [
      {
        type: "text",
        text: choice.message.content,
      },
    ],
  }));
};

export class OpenAIProvider implements TranslationProvider {
  async translate(
    text: string,
    sourceLang: string = "en-US",
    targetLang: string = "et-EE",
    context?: string,
    metadata?: TranslationMetadata
  ): Promise<string> {
    const additionalInstruction =
      "Never output any explanation,question, error message or reasoning, only the translation. You are translating spiritual talks, so if there is a word you do not understand, try to find a sensible word from the indian philosophy. Remove duplicate words, repetitions, and phrases like 'um' and similar";
    let prompt = `Translate the following text from ${sourceLang} to ${targetLang}. ${additionalInstruction}`;
    if (context) {
      prompt = `Translate the following text from ${sourceLang} to ${targetLang}. You are translating live subtitles that get updated every few seconds. Try not to change previously translated chunks. Previous chunk: ${context} ${additionalInstruction}. `;
    }

    const requestStartedAt = Date.now();
    const distinctId = metadata?.streamID;
    const traceId = metadata?.traceID || metadata?.streamID;
    const sessionId = metadata?.sessionID;
    const spanId = uuidv4();
    const spanName = "openai_translation";
    const requestMessages: OpenAIChatCompletionMessage[] = [
      {
        role: "system",
        content: prompt,
      },
      {
        role: "user",
        content: text,
      },
    ];
    const analyticsInput = toAnalyticsMessages(requestMessages);

    try {
      const response = await axios.post<OpenAIChatCompletionResponse>(
        OPENAI_CHAT_COMPLETIONS_URL,
        {
          model: DEFAULT_MODEL,
          messages: requestMessages,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      const usage = mapUsage(response.data.usage);
      const costs = calculateCosts(usage, response.data.model || DEFAULT_MODEL);
      const translatedText = response.data.choices[0].message.content.trim();

      captureAiGenerationEvent({
        distinctId,
        traceId,
        sessionId,
        spanId: response.data.id || spanId,
        spanName,
        provider: "openai",
        model: response.data.model || DEFAULT_MODEL,
        baseUrl: OPENAI_BASE_URL,
        requestUrl: OPENAI_CHAT_COMPLETIONS_URL,
        input: analyticsInput,
        outputChoices: toAnalyticsChoices(response.data),
        usage,
        latencyMs: Date.now() - requestStartedAt,
        httpStatus: response.status,
        cost: costs,
        metadata: {
          sourceLanguage: sourceLang,
          targetLanguage: targetLang,
          streamID: metadata?.streamID,
          openAiResponseId: response.data.id,
          translationContext: context,
          lastTranslatedText: translatedText,
        },
      });

      return translatedText;
    } catch (error) {
      const axiosError = axios.isAxiosError(error) ? error : undefined;
      const usage = axiosError?.response?.data?.usage
        ? mapUsage(axiosError.response.data.usage)
        : undefined;
      const costs = calculateCosts(usage, DEFAULT_MODEL);

      captureAiGenerationEvent({
        distinctId,
        traceId,
        sessionId,
        spanId,
        spanName,
        provider: "openai",
        model: DEFAULT_MODEL,
        baseUrl: OPENAI_BASE_URL,
        requestUrl: OPENAI_CHAT_COMPLETIONS_URL,
        input: analyticsInput,
        usage,
        latencyMs: Date.now() - requestStartedAt,
        httpStatus: axiosError?.response?.status,
        isError: true,
        error: axiosError?.response?.data || error,
        cost: costs,
        metadata: {
          sourceLanguage: sourceLang,
          targetLanguage: targetLang,
          streamID: metadata?.streamID,
          translationContext: context,
        },
      });

      console.error("Error translating text with OpenAI:", error);
      throw new Error("Translation failed");
    }
  }
}
