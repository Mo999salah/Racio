import { expect, test } from '@playwright/test';
import { signInAs, uniqueEmail } from './helpers';

test.describe('accounts', () => {
  test('creates an institution and an account, then archives and restores it', async ({ page }) => {
    await signInAs(page, uniqueEmail());
    await page.goto('/en/accounts');
    const name = `E2E Bank ${Date.now().toString().slice(-6)}`;

    // Institution panel is the first form panel.
    const institutionPanel = page.locator('.account-form-panel').first();
    await institutionPanel.getByRole('textbox').nth(0).fill(name);
    await institutionPanel.getByRole('textbox').nth(1).fill('US');
    await institutionPanel.getByRole('button', { name: /save institution/i }).click();

    const accountPanel = page.locator('.account-form-panel').nth(1);
    await accountPanel.getByRole('textbox').first().fill('Checking');
    await accountPanel.getByRole('combobox').nth(2).selectOption('USD');
    await accountPanel.getByRole('textbox').nth(1).fill('****4321');
    await accountPanel.getByRole('button', { name: /save account/i }).click();

    await expect(page.getByRole('heading', { name: 'Checking' })).toBeVisible();
    await expect(
      page.locator('.account-record-institution').filter({ hasText: name }),
    ).toBeVisible();

    // Archive and restore (native confirm dialog is accepted).
    page.on('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Checking' })).toBeHidden();
    await page.getByRole('button', { name: /show archived/i }).click();
    await expect(page.getByRole('heading', { name: 'Checking' })).toBeVisible();
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Checking' })).toBeVisible();
  });
});
