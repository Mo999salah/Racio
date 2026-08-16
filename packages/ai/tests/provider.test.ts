import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiConfig } from '@racio/config';
import { createAiRuntime, disabledAi, AiError, isAiError } from '../src/index';

function config(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    enabled: true,
    provider: 'openai-compatible',
    model: 'mock-model',
    apiKey: 'sk-test',
    baseUrl: 'https://mock.example/v1',
    timeoutMs: 1_000,
    maxInputChars: 2_000,
    maxOutputTokens: 500,
    maxToolCalls: 4,
    maxTransactionSamples: 20,
    maxRetries: 1,
    rateLimitWindowMs: 60_000,
    rateLimitMax: 20,
    ...overrides,
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('AI runtime', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('is disabled by default with no provider attached', async () => {
    const runtime = disabledAi;
    expect(runtime.availability).toBe('disabled');
    expect(runtime.provider).toBeUndefined();
    expect(runtime.remote).toBe(false);
  });

  it('disables the runtime when no provider is configured', () => {
    const runtime = createAiRuntime({ ...config(), enabled: false });
    expect(runtime.availability).toBe('disabled');
    expect(runtime.remote).toBe(false);
  });

  it('builds an available runtime from a complete configuration', () => {
    const runtime = createAiRuntime(config());
    expect(runtime.availability).toBe('available');
    expect(runtime.providerId).toBe('openai-compatible');
    expect(runtime.model).toBe('mock-model');
    expect(runtime.remote).toBe(true);
  });
});

describe('openai-compatible provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns parsed structured output on a valid response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' });
        expect(body.messages[1]).toEqual({ role: 'user', content: 'user' });
        return jsonResponse({
          model: 'mock-model',
          usage: { prompt_tokens: 10, completion_tokens: 5 },
          choices: [{ message: { content: '{"text":"hello","citedFacts":[]}' } }],
        });
      }),
    );
    const runtime = createAiRuntime(config());
    const response = await runtime.provider!.generateStructured({ system: 'sys', user: 'user' });
    expect(response.structured).toEqual({ text: 'hello', citedFacts: [] });
    expect(response.model).toBe('mock-model');
    expect(response.usage?.promptTokens).toBe(10);
  });

  it('returns text only when the body is not valid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ choices: [{ message: { content: 'not json' } }] })),
    );
    const runtime = createAiRuntime(config());
    const response = await runtime.provider!.generateStructured({ system: 's', user: 'u' });
    expect(response.structured).toBeUndefined();
    expect(response.text).toBe('not json');
  });

  it('maps a timeout to AI_TIMEOUT', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          const signal = init.signal as AbortSignal;
          signal.addEventListener('abort', () => {
            const error = new Error('The operation was aborted.');
            error.name = 'AbortError';
            reject(error);
          });
        });
      }),
    );
    const runtime = createAiRuntime({ ...config(), timeoutMs: 20 });
    await expect(
      runtime.provider!.generateStructured({ system: 's', user: 'u' }),
    ).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
  });

  it('maps HTTP 429 to AI_RATE_LIMITED', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'slow down' }, 429)),
    );
    const runtime = createAiRuntime(config());
    await expect(
      runtime.provider!.generateStructured({ system: 's', user: 'u' }),
    ).rejects.toMatchObject({
      code: 'AI_RATE_LIMITED',
    });
  });

  it('maps server errors to AI_PROVIDER_ERROR', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'boom' }, 500)),
    );
    const runtime = createAiRuntime(config());
    await expect(
      runtime.provider!.generateStructured({ system: 's', user: 'u' }),
    ).rejects.toMatchObject({
      code: 'AI_PROVIDER_ERROR',
    });
  });

  it('maps context-length rejections to AI_CONTEXT_LIMIT', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: { message: 'maximum context length' } }, 400)),
    );
    const runtime = createAiRuntime(config());
    await expect(
      runtime.provider!.generateStructured({ system: 's', user: 'u' }),
    ).rejects.toMatchObject({
      code: 'AI_CONTEXT_LIMIT',
    });
  });

  it('maps network failures to AI_PROVIDER_UNAVAILABLE', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('fetch failed'))),
    );
    const runtime = createAiRuntime(config());
    await expect(
      runtime.provider!.generateStructured({ system: 's', user: 'u' }),
    ).rejects.toMatchObject({
      code: 'AI_PROVIDER_UNAVAILABLE',
    });
  });

  it('rejects empty model output as AI_RESPONSE_INVALID', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ choices: [{ message: { content: '' } }] })),
    );
    const runtime = createAiRuntime(config());
    await expect(
      runtime.provider!.generateStructured({ system: 's', user: 'u' }),
    ).rejects.toMatchObject({
      code: 'AI_RESPONSE_INVALID',
    });
  });

  it('never exposes provider details in the safe error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'boom' }, 500)),
    );
    const runtime = createAiRuntime(config());
    try {
      await runtime.provider!.generateStructured({ system: 's', user: 'u' });
      expect.unreachable();
    } catch (error) {
      expect(isAiError(error)).toBe(true);
      const serialized = (error as AiError).toJSON();
      expect(JSON.stringify(serialized)).not.toContain('boom');
      expect(serialized.code).toBe('AI_PROVIDER_ERROR');
    }
  });
});
