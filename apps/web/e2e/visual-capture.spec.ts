import { test } from '@playwright/test';
import { signInAs, createAccountViaApi, uniqueEmail } from './helpers';

test.describe('hallmark visual capture', () => {
  test('capture key surfaces', async ({ page }) => {
    await signInAs(page, uniqueEmail('visual'));
    await createAccountViaApi(page, 'Visual Bank', 'USD');
    await page.goto('/en');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'test-results/hallmark-dashboard.png', fullPage: true });
    await page.goto('/en/budgets');
    await page.waitForTimeout(800);
    await page.screenshot({ path: 'test-results/hallmark-budgets.png', fullPage: true });
    await page.goto('/en/advisor');
    await page.waitForTimeout(800);
    await page.screenshot({ path: 'test-results/hallmark-advisor.png', fullPage: true });
    await page.goto('/en/export');
    await page.waitForTimeout(800);
    await page.screenshot({ path: 'test-results/hallmark-export.png', fullPage: true });
    await page.goto('/ar/accounts');
    await page.waitForTimeout(800);
    await page.screenshot({ path: 'test-results/hallmark-accounts-ar.png', fullPage: true });
  });
});
