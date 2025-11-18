import { PostHog } from 'posthog-node';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.POSTHOG_KEY;
const host = process.env.POSTHOG_HOST;

const posthog = apiKey
  ? new PostHog(apiKey, {
      host,
    })
  : null;
const baseProperties = {
  app: 'real-time-transcription',
  environment: process.env.NODE_ENV || 'prod',
};

export type AiMessageRole = 'user' | 'system' | 'assistant';

export interface AiMessageContent {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface AiMessage {
  role: AiMessageRole;
  content: AiMessageContent[];
}

export interface AiGenerationUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface AiCostProperties {
  inputCostUsd?: number;
  outputCostUsd?: number;
  requestCostUsd?: number;
  webSearchCostUsd?: number;
  totalCostUsd?: number;
  inputTokenPrice?: number;
  outputTokenPrice?: number;
  cacheReadTokenPrice?: number;
  cacheWriteTokenPrice?: number;
  requestPrice?: number;
  requestCount?: number;
  webSearchPrice?: number;
  webSearchCount?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

export interface AiGenerationAnalyticsPayload {
  distinctId?: string;
  traceId?: string;
  sessionId?: string;
  spanId?: string;
  parentId?: string;
  spanName?: string;
  provider: string;
  model: string;
  baseUrl?: string;
  requestUrl?: string;
  input?: AiMessage[];
  outputChoices?: AiMessage[];
  usage?: AiGenerationUsage;
  latencyMs?: number;
  httpStatus?: number;
  isError?: boolean;
  error?: unknown;
  metadata?: Record<string, unknown>;
  cost?: AiCostProperties;
  temperature?: number;
  stream?: boolean;
  maxTokens?: number;
  tools?: unknown;
}

const truncateForAnalytics = (value?: string, maxLength = 2000) => {
  if (!value) return value;
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
};

const sanitizeMessages = (messages?: AiMessage[]) =>
  messages?.map((message) => ({
    ...message,
    content: message.content?.map((contentItem) => {
      if (typeof contentItem.text === 'string') {
        return {
          ...contentItem,
          text: truncateForAnalytics(contentItem.text),
        };
      }
      return contentItem;
    }),
  }));

const sanitizeError = (error: unknown) => {
  if (!error) return error;
  if (error instanceof Error) {
    return {
      name: error.name,
      message: truncateForAnalytics(error.message, 1000),
      stack: truncateForAnalytics(error.stack || undefined, 2000),
    };
  }
  if (typeof error === 'object') {
    try {
      return JSON.parse(JSON.stringify(error));
    } catch (_err) {
      return String(error);
    }
  }
  return truncateForAnalytics(String(error), 1000);
};

export const captureServerEvent = (
  event: string,
  distinctId?: string,
  properties: Record<string, unknown> = {}
) => {
  if (!posthog) return;

  posthog.capture({
    distinctId: distinctId || 'server',
    event,
    properties: {
      ...baseProperties,
      ...properties,
    },
  });
};

export const captureAiGenerationEvent = (payload: AiGenerationAnalyticsPayload) => {
  if (!posthog) return;

  const aiLatencySeconds = typeof payload.latencyMs === 'number' ? payload.latencyMs / 1000 : undefined;
  const cost = payload.cost || {};
  const metadata = payload.metadata || {};

  posthog.capture({
    distinctId: payload.distinctId || 'server',
    event: '$ai_generation',
    properties: {
      ...baseProperties,
      $ai_trace_id: payload.traceId,
      $ai_session_id: payload.sessionId,
      $ai_span_id: payload.spanId,
      $ai_parent_id: payload.parentId,
      $ai_span_name: payload.spanName,
      $ai_provider: payload.provider,
      $ai_model: payload.model,
      $ai_base_url: payload.baseUrl,
      $ai_request_url: payload.requestUrl,
      $ai_input: sanitizeMessages(payload.input),
      $ai_output_choices: sanitizeMessages(payload.outputChoices),
      $ai_input_tokens: payload.usage?.promptTokens,
      $ai_output_tokens: payload.usage?.completionTokens,
      $ai_latency: aiLatencySeconds,
      $ai_http_status: payload.httpStatus,
      $ai_is_error: payload.isError,
      $ai_error: sanitizeError(payload.error),
      $ai_temperature: payload.temperature,
      $ai_stream: payload.stream,
      $ai_max_tokens: payload.maxTokens,
      $ai_tools: payload.tools,
      $ai_input_cost_usd: cost.inputCostUsd,
      $ai_output_cost_usd: cost.outputCostUsd,
      $ai_request_cost_usd: cost.requestCostUsd,
      $ai_web_search_cost_usd: cost.webSearchCostUsd,
      $ai_total_cost_usd: cost.totalCostUsd,
      $ai_input_token_price: cost.inputTokenPrice,
      $ai_output_token_price: cost.outputTokenPrice,
      $ai_cache_read_token_price: cost.cacheReadTokenPrice,
      $ai_cache_write_token_price: cost.cacheWriteTokenPrice,
      $ai_request_price: cost.requestPrice,
      $ai_request_count: cost.requestCount,
      $ai_web_search_price: cost.webSearchPrice,
      $ai_web_search_count: cost.webSearchCount,
      $ai_cache_read_input_tokens: cost.cacheReadInputTokens,
      $ai_cache_creation_input_tokens: cost.cacheCreationInputTokens,
      ...metadata,
    },
  });
};

export const captureServerError = (
  event: string,
  error: unknown,
  distinctId?: string,
  properties: Record<string, unknown> = {}
) => {
  captureServerEvent(event, distinctId, {
    ...properties,
    errorName: error instanceof Error ? error.name : 'Error',
    errorMessage: error instanceof Error ? error.message : String(error),
    errorStack: error instanceof Error ? error.stack : undefined,
  });
};

export const identifyStream = (distinctId: string, properties: Record<string, unknown> = {}) => {
  if (!posthog) return;
  posthog.identify({
    distinctId,
    properties,
  });
};

export const shutdownPosthog = async () => {
  if (!posthog) return;
  await posthog.shutdown();
};
