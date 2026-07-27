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
  IMPORT_ORPHAN_RETENTION_HOURS: z.coerce.number().int().positive().max(720).default(24),
  PARSER_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(30_000),
  PG_BOSS_SCHEMA: z.string().default('pgboss'),
});

export type AppEnv = z.infer<typeof rawEnvSchema> & {
  betterAuthSecret: string;
  providers: {
    google: boolean;
    apple: boolean;
  };
};

export function readAppEnv(input: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = rawEnvSchema.parse(input);
  const secret =
    parsed.BETTER_AUTH_SECRET ??
    (parsed.NODE_ENV === 'production' ? '' : 'racio-local-development-secret-change-me-32');

  if (parsed.NODE_ENV === 'production' && secret.length < 32) {
    throw new Error('BETTER_AUTH_SECRET must be set to at least 32 characters in production.');
  }

  const google = Boolean(parsed.GOOGLE_CLIENT_ID && parsed.GOOGLE_CLIENT_SECRET);
  const apple = Boolean(
    parsed.APPLE_CLIENT_ID &&
    parsed.APPLE_TEAM_ID &&
    parsed.APPLE_KEY_ID &&
    parsed.APPLE_PRIVATE_KEY,
  );

  return {
    ...parsed,
    betterAuthSecret: secret,
    providers: { google, apple },
  };
}
