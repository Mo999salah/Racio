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

  it('rejects known example or default secrets in production', () => {
    expect(() =>
      readAppEnv({
        NODE_ENV: 'production',
        BETTER_AUTH_SECRET: 'racio-local-development-secret-change-me-32',
      }),
    ).toThrow(/known example or default/);
  });

  it('rejects a non-https production base URL', () => {
    expect(() =>
      readAppEnv({
        NODE_ENV: 'production',
        BETTER_AUTH_SECRET: 'a-strong-production-secret-value-that-is-long-enough-42',
      }),
    ).toThrow(/https/);
  });

  it('accepts a strong production secret with an https base URL', () => {
    const env = readAppEnv({
      NODE_ENV: 'production',
      BETTER_AUTH_SECRET: 'a-strong-production-secret-value-that-is-long-enough-42',
      BETTER_AUTH_URL: 'https://racio.example.com',
    });
    expect(env.betterAuthSecret).toMatch(/^a-strong-production-secret/);
  });

  it('allows the worker to start without auth credentials in production', () => {
    const env = readAppEnv(
      {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://racio:secret@db:5432/racio',
        PARSER_URL: 'http://parser:8001',
      },
      { requireAuth: false },
    );
    expect(env.DATABASE_URL).toContain('db:5432');
  });

  it('requires complete provider configuration', () => {
    const env = readAppEnv({ NODE_ENV: 'test', GOOGLE_CLIENT_ID: 'client-id' });
    expect(env.providers.google).toBe(false);
  });

  it('provides conservative configurable XLSX limits', () => {
    const env = readAppEnv({ NODE_ENV: 'test' });
    expect(env.MAX_XLSX_ARCHIVE_BYTES).toBe(20 * 1024 * 1024);
    expect(env.MAX_XLSX_UNCOMPRESSED_BYTES).toBe(100 * 1024 * 1024);
    expect(env.MAX_XLSX_ROWS).toBe(100_000);
    expect(env.MAX_XLSX_COLUMNS).toBe(256);
    expect(env.MAX_XLSX_COMPRESSION_RATIO).toBe(100);
  });

  it('provides conservative configurable PDF limits', () => {
    const env = readAppEnv({ NODE_ENV: 'test' });
    expect(env.MAX_PDF_UPLOAD_BYTES).toBe(20 * 1024 * 1024);
    expect(env.MAX_PDF_PAGES).toBe(200);
    expect(env.MAX_PDF_PAGE_DIMENSION_POINTS).toBe(14_400);
    expect(env.MAX_PDF_CHARS_PER_PAGE).toBe(200_000);
    expect(env.MAX_PDF_TOTAL_CHARS).toBe(2_000_000);
    expect(env.MAX_PDF_WORDS_PER_PAGE).toBe(40_000);
    expect(env.MAX_PDF_CANDIDATES).toBe(50_000);
  });

  it('disables AI by default without provider credentials', () => {
    const env = readAppEnv({ NODE_ENV: 'test' });
    expect(env.ai.enabled).toBe(false);
    expect(env.ai.provider).toBe('none');
    expect(env.ai.apiKey).toBeNull();
  });

  it('provides conservative configurable export limits', () => {
    const env = readAppEnv({ NODE_ENV: 'test' });
    expect(env.EXPORT_SYNC_MAX_ROWS).toBe(10_000);
    expect(env.EXPORT_MAX_ROWS).toBe(250_000);
    expect(env.EXPORT_MAX_FILE_BYTES).toBe(50 * 1024 * 1024);
    expect(env.EXPORT_MAX_ARCHIVE_RECORDS).toBe(100_000);
    expect(env.EXPORT_RETENTION_HOURS).toBe(24);
    expect(env.EXPORT_MAX_CONCURRENT_PER_USER).toBe(3);
  });

  it('requires an API key when AI is enabled', () => {
    expect(() =>
      readAppEnv({ NODE_ENV: 'test', AI_ENABLED: 'true', AI_PROVIDER: 'openai-compatible' }),
    ).toThrow(/AI_API_KEY/);
  });

  it('builds an AI configuration from environment', () => {
    const env = readAppEnv({
      NODE_ENV: 'test',
      AI_ENABLED: 'true',
      AI_PROVIDER: 'openai-compatible',
      AI_API_KEY: 'sk-test',
      AI_MODEL: 'gpt-test',
      AI_MAX_TRANSACTION_SAMPLES: '5',
    });
    expect(env.ai.enabled).toBe(true);
    expect(env.ai.provider).toBe('openai-compatible');
    expect(env.ai.model).toBe('gpt-test');
    expect(env.ai.maxTransactionSamples).toBe(5);
    expect(env.ai.timeoutMs).toBe(30_000);
  });
});
