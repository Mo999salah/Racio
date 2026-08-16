import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Playwright specs run under the Playwright runner (`pnpm test:e2e`),
    // never under vitest.
    exclude: ['e2e/**', 'e2e-prod/**', 'node_modules/**', 'test-results/**'],
  },
});
