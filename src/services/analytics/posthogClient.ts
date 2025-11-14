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
