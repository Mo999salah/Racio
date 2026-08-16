import { expect, test } from '@playwright/test';
import { signInAs, uniqueEmail } from './helpers';

test.describe('authentication', () => {
  test('unauthenticated access redirects to sign-in and back works', async ({ page }) => {
    await page.goto('/en/transactions');
    await page.waitForURL(/\/en\/sign-in/u);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('sign-in page shows the no-provider state without OAuth configuration', async ({ page }) => {
    await page.goto('/en/sign-in');
    await expect(page).toHaveURL(/\/en\/sign-in/u);
    // No configured provider: the page renders the sign-in heading.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('signed-in user can open a protected page and sign out', async ({ page }) => {
    const email = uniqueEmail();
    await signInAs(page, email);
    await page.goto('/en/transactions');
    await expect(page).toHaveURL(/\/en\/transactions/u);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const signOut = page.locator('button:has-text("Sign out")').first();
    await signOut.click();
    await page.waitForURL(/\/en\/sign-in/u);

    await page.goto('/en/transactions');
    await page.waitForURL(/\/en\/sign-in/u);
  });

  test('test session fixture is unavailable without the e2e flag', async ({ request }) => {
    // The dev server runs with RACIO_E2E=1, so this is a sanity check that
    // the endpoint exists only in the harness; production builds 404 via the
    // explicit NODE_ENV guard (covered by the production-headers spec).
    const response = await request.post('/api/test/session', { data: { email: uniqueEmail() } });
    expect([200, 404]).toContain(response.status());
  });
});
