import type { AiConfig } from '@racio/config';
import { AiError } from './errors';
import { OpenAiCompatibleProvider } from './providers/openai-compatible';
import { DISABLED_PROVIDER_ID, type AiProvider, type AiResponse, type AiRuntime } from './types';

/**
 * Deterministic fallback for the disabled runtime. The advisor must never
 * reach a provider when AI is disabled; any call fails with a stable code.
 */
function disabledProvider(): AiProvider {
  return {
    id: DISABLED_PROVIDER_ID,
    async generateStructured(): Promise<AiResponse> {
      throw new AiError('AI_DISABLED');
    },
  };
}

export function createAiRuntime(config: AiConfig): AiRuntime {
  if (!config.enabled) {
    return {
      availability: 'disabled',
      providerId: DISABLED_PROVIDER_ID,
      model: null,
      remote: false,
      config,
    };
  }
  if (config.provider === 'openai-compatible' && config.apiKey) {
    return {
      availability: 'available',
      provider: new OpenAiCompatibleProvider(config),
      providerId: config.provider,
      model: config.model,
      remote: true,
      config,
    };
  }
  // A provider is configured but incomplete; fail closed instead of silently
  // sending data somewhere unexpected.
  return {
    availability: 'disabled',
    provider: disabledProvider(),
    providerId: DISABLED_PROVIDER_ID,
    model: null,
    remote: false,
    config,
  };
}

/** Safe provider identity for telemetry: provider id and model, never secrets. */
export function providerIdentity(runtime: AiRuntime) {
  return { providerId: runtime.providerId, model: runtime.model };
}
