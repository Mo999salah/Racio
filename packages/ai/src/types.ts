import type { AiConfig } from '@racio/config';

export type AiAvailability = 'disabled' | 'available';

export type AiRequest = {
  /** Versioned system instructions. Never concatenated with untrusted data. */
  system: string;
  /** The user-facing question and validated tool facts (untrusted data). */
  user: string;
  /** JSON schema hint for structured output, when the provider supports it. */
  responseJsonSchema?: Record<string, unknown>;
  maxOutputTokens?: number;
  signal?: AbortSignal;
};

export type AiResponse = {
  text: string;
  structured?: unknown;
  model?: string;
  usage?: { promptTokens?: number; completionTokens?: number };
};

/**
 * Provider boundary. Implementations never touch PostgreSQL, never execute
 * SQL, never receive DB credentials, and never run model-produced code.
 */
export type AiProvider = {
  readonly id: string;
  generateStructured(input: AiRequest): Promise<AiResponse>;
};

export type AiRuntime = {
  availability: AiAvailability;
  provider?: AiProvider;
  providerId: string | null;
  model: string | null;
  /** True when the provider is remote (data leaves the server). */
  remote: boolean;
  config: AiConfig;
};

export const DISABLED_PROVIDER_ID = 'none';
