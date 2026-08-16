import type { AiRuntime } from './types';
import { DISABLED_PROVIDER_ID } from './types';

/** Disabled runtime with no provider; every advisor call fails with AI_DISABLED. */
export const disabledAi: AiRuntime = {
  availability: 'disabled',
  providerId: DISABLED_PROVIDER_ID,
  model: null,
  remote: false,
  config: {
    enabled: false,
    provider: 'none',
    model: null,
    apiKey: null,
    baseUrl: '',
    timeoutMs: 30_000,
    maxInputChars: 2_000,
    maxOutputTokens: 500,
    maxToolCalls: 4,
    maxTransactionSamples: 20,
    maxRetries: 1,
    rateLimitWindowMs: 60_000,
    rateLimitMax: 20,
  },
};
