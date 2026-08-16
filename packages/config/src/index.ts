import { z } from 'zod';

const rawEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url().default('postgresql://racio:racio_dev@localhost:5432/racio'),
  BETTER_AUTH_SECRET: z.string().optional(),
  BETTER_AUTH_URL: z.string().url().default('http://localhost:3000'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_TEAM_ID: z.string().optional(),
  APPLE_KEY_ID: z.string().optional(),
  APPLE_PRIVATE_KEY: z.string().optional(),
  PARSER_URL: z.string().url().default('http://localhost:8001'),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  LOCAL_STORAGE_PATH: z.string().default('./uploads'),
  MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(50 * 1024 * 1024)
    .default(20 * 1024 * 1024),
  MAX_CSV_ROWS: z.coerce.number().int().positive().max(250_000).default(50_000),
  MAX_CSV_FIELD_LENGTH: z.coerce.number().int().positive().max(1_000_000).default(20_000),
  MAX_CSV_LINE_LENGTH: z.coerce.number().int().positive().max(2_000_000).default(100_000),
  MAX_XLSX_ARCHIVE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(50 * 1024 * 1024)
    .default(20 * 1024 * 1024),
  MAX_XLSX_UNCOMPRESSED_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(500 * 1024 * 1024)
    .default(100 * 1024 * 1024),
  MAX_XLSX_COMPRESSION_RATIO: z.coerce.number().positive().max(1_000).default(100),
  MAX_XLSX_ZIP_ENTRIES: z.coerce.number().int().positive().max(10_000).default(2_048),
  MAX_XLSX_SHEETS: z.coerce.number().int().positive().max(256).default(32),
  MAX_XLSX_ROWS: z.coerce.number().int().positive().max(1_000_000).default(100_000),
  MAX_XLSX_COLUMNS: z.coerce.number().int().positive().max(16_384).default(256),
  MAX_XLSX_POPULATED_CELLS: z.coerce.number().int().positive().max(5_000_000).default(500_000),
  MAX_XLSX_SHARED_STRINGS: z.coerce.number().int().positive().max(2_000_000).default(250_000),
  MAX_XLSX_CELL_STRING_LENGTH: z.coerce.number().int().positive().max(1_000_000).default(20_000),
  MAX_XLSX_FORMULAS: z.coerce.number().int().nonnegative().max(500_000).default(10_000),
  MAX_XLSX_MERGED_RANGES: z.coerce.number().int().nonnegative().max(100_000).default(2_000),
  MAX_PDF_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(50 * 1024 * 1024)
    .default(20 * 1024 * 1024),
  MAX_PDF_PAGES: z.coerce.number().int().positive().max(2_000).default(200),
  MAX_PDF_PAGE_DIMENSION_POINTS: z.coerce.number().int().positive().max(50_000).default(14_400),
  MAX_PDF_CHARS_PER_PAGE: z.coerce.number().int().positive().max(2_000_000).default(200_000),
  MAX_PDF_TOTAL_CHARS: z.coerce.number().int().positive().max(20_000_000).default(2_000_000),
  MAX_PDF_WORDS_PER_PAGE: z.coerce.number().int().positive().max(400_000).default(40_000),
  MAX_PDF_CANDIDATES: z.coerce.number().int().positive().max(500_000).default(50_000),
  IMPORT_ORPHAN_RETENTION_HOURS: z.coerce.number().int().positive().max(720).default(24),
  PARSER_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(30_000),
  PG_BOSS_SCHEMA: z.string().default('pgboss'),
  AI_ENABLED: z.coerce.boolean().default(false),
  AI_PROVIDER: z.enum(['none', 'openai-compatible']).default('none'),
  AI_MODEL: z.string().optional(),
  AI_API_KEY: z.string().optional(),
  AI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().max(300_000).default(30_000),
  AI_MAX_INPUT_CHARS: z.coerce.number().int().positive().max(10_000).default(2_000),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().max(4_000).default(500),
  AI_MAX_TOOL_CALLS: z.coerce.number().int().positive().max(32).default(4),
  AI_MAX_TRANSACTION_SAMPLES: z.coerce.number().int().positive().max(200).default(20),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(1),
  AI_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().max(3_600_000).default(60_000),
  AI_RATE_LIMIT_MAX: z.coerce.number().int().positive().max(10_000).default(20),
  EXPORT_SYNC_MAX_ROWS: z.coerce.number().int().positive().max(250_000).default(10_000),
  EXPORT_MAX_ROWS: z.coerce.number().int().positive().max(1_000_000).default(250_000),
  EXPORT_MAX_FILE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(500 * 1024 * 1024)
    .default(50 * 1024 * 1024),
  EXPORT_MAX_ARCHIVE_RECORDS: z.coerce.number().int().positive().max(500_000).default(100_000),
  EXPORT_RETENTION_HOURS: z.coerce.number().int().positive().max(720).default(24),
  EXPORT_MAX_CONCURRENT_PER_USER: z.coerce.number().int().positive().max(20).default(3),
  RACIO_VERSION: z.string().optional(),
});

const INSECURE_KNOWN_SECRETS = new Set([
  'racio-local-development-secret-change-me-32',
  'change-me',
  'changeme',
  'secret',
  'password',
  'development-secret',
  'racio-secret',
  'your-secret-key-here',
]);

function assertProductionSecret(secret: string): void {
  if (secret.length < 32) {
    throw new Error('BETTER_AUTH_SECRET must be set to at least 32 characters in production.');
  }
  if (INSECURE_KNOWN_SECRETS.has(secret.toLowerCase())) {
    throw new Error(
      'BETTER_AUTH_SECRET must not use a known example or default value in production.',
    );
  }
}

function assertProductionBaseUrl(url: string): void {
  if (!url.startsWith('https://')) {
    throw new Error('BETTER_AUTH_URL must use https in production.');
  }
}

export type AiConfig = {
  enabled: boolean;
  provider: 'none' | 'openai-compatible';
  model: string | null;
  apiKey: string | null;
  baseUrl: string;
  timeoutMs: number;
  maxInputChars: number;
  maxOutputTokens: number;
  maxToolCalls: number;
  maxTransactionSamples: number;
  maxRetries: number;
  rateLimitWindowMs: number;
  rateLimitMax: number;
};

export type AppEnv = z.infer<typeof rawEnvSchema> & {
  version: string;
  betterAuthSecret: string;
  providers: {
    google: boolean;
    apple: boolean;
  };
  ai: AiConfig;
};

export function readAppEnv(
  input: NodeJS.ProcessEnv = process.env,
  options: { requireAuth?: boolean } = {},
): AppEnv {
  const parsed = rawEnvSchema.parse(input);
  const requireAuth = options.requireAuth ?? true;
  const secret =
    parsed.BETTER_AUTH_SECRET ??
    (parsed.NODE_ENV === 'production' ? '' : 'racio-local-development-secret-change-me-32');

  // The worker never serves Better Auth traffic; it must be able to start in
  // production with only its own environment (database, parser, storage,
  // export limits) and without any authentication secret.
  if (parsed.NODE_ENV === 'production' && requireAuth) {
    assertProductionSecret(secret);
    assertProductionBaseUrl(parsed.BETTER_AUTH_URL);
  }

  const google = Boolean(parsed.GOOGLE_CLIENT_ID && parsed.GOOGLE_CLIENT_SECRET);
  const apple = Boolean(
    parsed.APPLE_CLIENT_ID &&
    parsed.APPLE_TEAM_ID &&
    parsed.APPLE_KEY_ID &&
    parsed.APPLE_PRIVATE_KEY,
  );

  const aiEnabled = parsed.AI_ENABLED && parsed.AI_PROVIDER !== 'none';
  if (aiEnabled && parsed.AI_PROVIDER === 'openai-compatible' && !parsed.AI_API_KEY)
    throw new Error(
      'AI_API_KEY is required when AI is enabled with an openai-compatible provider.',
    );

  return {
    ...parsed,
    version: parsed.RACIO_VERSION ?? '0.0.0-dev',
    betterAuthSecret: secret,
    providers: { google, apple },
    ai: {
      enabled: aiEnabled,
      provider: parsed.AI_PROVIDER,
      model: parsed.AI_MODEL ?? null,
      apiKey: parsed.AI_API_KEY ?? null,
      baseUrl: parsed.AI_BASE_URL,
      timeoutMs: parsed.AI_TIMEOUT_MS,
      maxInputChars: parsed.AI_MAX_INPUT_CHARS,
      maxOutputTokens: parsed.AI_MAX_OUTPUT_TOKENS,
      maxToolCalls: parsed.AI_MAX_TOOL_CALLS,
      maxTransactionSamples: parsed.AI_MAX_TRANSACTION_SAMPLES,
      maxRetries: parsed.AI_MAX_RETRIES,
      rateLimitWindowMs: parsed.AI_RATE_LIMIT_WINDOW_MS,
      rateLimitMax: parsed.AI_RATE_LIMIT_MAX,
    },
  };
}
