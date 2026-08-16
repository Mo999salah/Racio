import { defineConfig, devices } from '@playwright/test';

const databaseUrl =
  process.env.RACIO_TEST_DATABASE_URL ?? 'postgresql://racio:racio_dev@localhost:5433/racio';
const webPort = 3110;

/**
 * Production-mode verification: runs the production build (`next start`) and
 * asserts security headers, CSP nonce behavior, readiness, and that the
 * test-only session fixture is inert in production. Requires the production
 * build to exist: run `pnpm --filter @racio/web build` first.
 */
export default defineConfig({
  testDir: './e2e-prod',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${webPort}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `node node_modules/next/dist/bin/next start -p ${webPort}`,
      url: `http://localhost:${webPort}/api/health/live`,
      reuseExistingServer: true,
      timeout: 60_000,
      env: {
        NODE_ENV: 'production',
        DATABASE_URL: databaseUrl,
        BETTER_AUTH_SECRET: 'production-e2e-secret-value-that-is-long-enough-42',
        BETTER_AUTH_URL: 'https://racio.example.test',
        PARSER_URL: 'http://localhost:8001',
        LOCAL_STORAGE_PATH: '.e2e-prod-storage',
        RACIO_E2E: '1',
      },
    },
  ],
});
