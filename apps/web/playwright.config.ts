import { defineConfig, devices } from '@playwright/test';
import { join } from 'node:path';

const databaseUrl =
  process.env.RACIO_TEST_DATABASE_URL ?? 'postgresql://racio:racio_dev@localhost:5433/racio';
const webPort = 3100;
const workerPort = 3101;
const parserPort = 8001;
// Absolute shared private-storage root: the web server writes uploads and the
// worker reads them, so both must resolve to the same directory.
const storageRoot = process.env.RACIO_TEST_STORAGE_ROOT ?? join(process.cwd(), '.e2e-storage');

const sharedEnv = {
  NODE_ENV: 'development',
  DATABASE_URL: databaseUrl,
  PARSER_URL: `http://localhost:${parserPort}`,
  LOCAL_STORAGE_PATH: storageRoot,
  PG_BOSS_SCHEMA: 'pgboss',
  RACIO_E2E: '1',
  BETTER_AUTH_SECRET: 'e2e-test-only-secret-that-is-long-enough-42',
  BETTER_AUTH_URL: `http://localhost:${webPort}`,
  IMPORT_ORPHAN_RETENTION_HOURS: '1',
  EXPORT_RETENTION_HOURS: '24',
};

/**
 * Browser end-to-end suite for critical flows. Requires:
 * - PostgreSQL at RACIO_TEST_DATABASE_URL with migrations applied
 * - `pnpm --filter @racio/parser exec uv run uvicorn ...` (started here)
 * The worker and the web dev server are started here; the parser service is
 * expected to run on PARSER_URL (it needs a Python venv; start it with
 * `uv run uvicorn racio_parser.main:app --port 8001` from apps/parser, or run
 * `pnpm test:e2e` with the parser already up).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${webPort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @racio/worker dev',
      url: `http://localhost:${workerPort}/health`,
      reuseExistingServer: true,
      timeout: 120_000,
      env: { ...sharedEnv, WORKER_HEALTH_PORT: String(workerPort) },
    },
    {
      command: `pnpm --filter @racio/web dev --port ${webPort}`,
      url: `http://localhost:${webPort}/api/health/live`,
      reuseExistingServer: true,
      timeout: 120_000,
      env: sharedEnv,
    },
  ],
});
