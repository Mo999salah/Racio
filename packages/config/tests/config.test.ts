import { describe, expect, it } from 'vitest';
import { readAppEnv } from '../src/index';

describe('application environment', () => {
  it('allows local boot without OAuth providers', () => {
    const env = readAppEnv({ NODE_ENV: 'development' });
    expect(env.providers).toEqual({ google: false, apple: false });
  });

  it('rejects a missing production auth secret', () => {
    expect(() => readAppEnv({ NODE_ENV: 'production' })).toThrow(/BETTER_AUTH_SECRET/);
  });

  it('requires complete provider configuration', () => {
    const env = readAppEnv({ NODE_ENV: 'test', GOOGLE_CLIENT_ID: 'client-id' });
    expect(env.providers.google).toBe(false);
  });
});
