import { createAiRuntime } from '@racio/ai';
import { InMemoryRateLimiter } from '@racio/advisor';
import { readAppEnv } from '@racio/config';

/**
 * Server-side AI runtime and advisor rate limiter. The runtime is built lazily
 * from environment config once per process; secrets never reach the client.
 * When AI is disabled the runtime reports `availability: 'disabled'` and every
 * advisor call fails with a stable AI_DISABLED error. The limiter is
 * in-process: the MVP deployment topology is one web instance (documented in
 * `docs/deployment.md`); a shared limiter is required before multi-instance.
 */
let cachedRuntime: ReturnType<typeof createAiRuntime> | undefined;
let cachedLimiter: InMemoryRateLimiter | undefined;

export function getAiRuntime() {
  cachedRuntime ??= createAiRuntime(readAppEnv().ai);
  return cachedRuntime;
}

export function getAdvisorRateLimiter() {
  const ai = readAppEnv().ai;
  cachedLimiter ??= new InMemoryRateLimiter(ai.rateLimitWindowMs, ai.rateLimitMax);
  return cachedLimiter;
}
