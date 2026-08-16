import { expect, test } from '@playwright/test';
import { signInAs, uniqueEmail } from './helpers';

test.describe('responsive, RTL, and dark mode', () => {
  test('desktop and mobile have no horizontal overflow on critical pages', async ({ page }) => {
    await signInAs(page, uniqueEmail());
    for (const path of ['/en/transactions', '/en/export', '/en/budgets', '/en/accounts']) {
      await page.goto(path);
      await expect(page, `page ${path} should render`).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflow, `${path} should not overflow horizontally`).toBe(false);
    }

    const mobile = await page.context().newPage();
    await mobile.setViewportSize({ width: 375, height: 740 });
    await mobile.goto('/en/transactions');
    const overflow = await mobile.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow, 'mobile transactions page should not overflow').toBe(false);
    await mobile.close();
  });

  test('Arabic pages set dir=rtl and render the sign-in heading', async ({ page }) => {
    await page.goto('/ar/sign-in');
    const rtlRoot = page.locator('html [lang="ar"][dir="rtl"]').first();
    await expect(rtlRoot).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('dark mode preference applies the dark theme', async ({ page }) => {
    await signInAs(page, uniqueEmail());
    const response = await page.request.patch('/api/preferences', {
      data: { locale: 'en', timeZone: 'UTC', interfaceMode: 'easy', appearance: 'dark' },
    });
    expect(response.status(), await response.text()).toBe(200);
    await page.goto('/en/transactions');
    await expect
      .poll(() => page.locator('html').evaluate((element) => element.getAttribute('data-theme')))
      .toBe('dark');
  });
});
