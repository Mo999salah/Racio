import type { AiConfig } from '@racio/config';
import { AiError } from '../errors';
import type { AiProvider, AiRequest, AiResponse } from '../types';

/**
 * Configurable OpenAI-compatible chat-completions provider. Uses only fetch:
 * no vendor SDK is hard-coded into the advisor. Provider config comes from
 * environment/server config; secrets never reach the client.
 *
 * Transport errors are mapped to stable AiError codes. A non-JSON body is
 * returned as `text` only so the caller can run a bounded repair retry; this
 * provider never executes anything the model produced.
 */
export class OpenAiCompatibleProvider implements AiProvider {
  readonly id = 'openai-compatible';

  constructor(private readonly config: AiConfig) {}

  async generateStructured(input: AiRequest): Promise<AiResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    if (input.signal) {
      if (input.signal.aborted) controller.abort();
      else input.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    try {
      const response = await fetch(`${this.config.baseUrl.replace(/\/+$/u, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey ?? ''}`,
        },
        body: JSON.stringify({
          model: this.config.model ?? 'gpt-4o-mini',
          messages: [
            { role: 'system', content: input.system },
            { role: 'user', content: input.user },
          ],
          response_format: { type: 'json_object' },
          max_tokens: input.maxOutputTokens ?? this.config.maxOutputTokens,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw this.mapHttpError(response.status);
      }

      const payload = (await response.json()) as {
        model?: string;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.trim().length === 0) {
        throw new AiError('AI_RESPONSE_INVALID');
      }
      let structured: unknown;
      try {
        structured = JSON.parse(content) as unknown;
      } catch {
        structured = undefined;
      }
      return {
        text: content,
        structured,
        model: payload.model,
        usage: {
          promptTokens: payload.usage?.prompt_tokens,
          completionTokens: payload.usage?.completion_tokens,
        },
      };
    } catch (error) {
      if (error instanceof AiError) throw error;
      if (error instanceof Error && error.name === 'AbortError') throw new AiError('AI_TIMEOUT');
      throw new AiError('AI_PROVIDER_UNAVAILABLE');
    } finally {
      clearTimeout(timeout);
    }
  }

  private mapHttpError(status: number): AiError {
    if (status === 429) return new AiError('AI_RATE_LIMITED');
    if (status === 400 || status === 413 || status === 422) return new AiError('AI_CONTEXT_LIMIT');
    if (status >= 500) return new AiError('AI_PROVIDER_ERROR');
    return new AiError('AI_PROVIDER_ERROR');
  }
}
