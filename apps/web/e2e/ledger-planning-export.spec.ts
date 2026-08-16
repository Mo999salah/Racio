import { expect, test } from '@playwright/test';
import {
  confirmImportViaApi,
  createAccountViaApi,
  createBudgetViaApi,
  signInAs,
  uniqueEmail,
  uploadStatement,
  waitForImportStatus,
} from './helpers';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/statements');

test.describe('ledger, planning, and export integrity', () => {
  test('imported transactions render in the ledger, a budget reflects spending, and a CSV export downloads', async ({
    page,
  }) => {
    await signInAs(page, uniqueEmail());
    const { accountId } = await createAccountViaApi(page);
    const statementId = await uploadStatement(page, `${FIXTURES}/csv/debit-credit.csv`, accountId);
    await waitForImportStatus(page, statementId, ['needs_review', 'ready']);
    await confirmImportViaApi(page, statementId);

    // Ledger renders the confirmed rows.
    await page.goto('/en/transactions');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText('Deposit', { exact: false })).toBeVisible();
    await expect(page.getByText('Purchase', { exact: false })).toBeVisible();

    // Budget over the imported spending.
    const budgetId = await createBudgetViaApi(page, 'USD', '1000.00', 'E2E Budget');
    await page.goto('/en/budgets');
    await expect(page.getByText('E2E Budget')).toBeVisible();

    // CSV export through the export surface, then download it.
    await page.goto('/en/export');
    await page.getByRole('radio', { name: 'CSV' }).check();
    await page
      .locator('section.export-section')
      .filter({ has: page.getByRole('radio', { name: 'CSV' }) })
      .getByRole('button', { name: /generate export/i })
      .click();
    await page
      .getByRole('button', { name: /generate export/i })
      .first()
      .waitFor();
    await expect(page.getByText(/preparing|ready/i).first()).toBeVisible({ timeout: 30_000 });

    const ready = page.locator('a:has-text("Download")').first();
    await expect(ready).toBeVisible({ timeout: 60_000 });
    const downloadPromise = page.waitForEvent('download');
    await ready.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^racio-transactions-\d{4}-\d{2}-\d{2}\.csv$/u);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const content = Buffer.concat(chunks).toString('utf8');
    expect(content).toContain('amount_exact');
    expect(content).toContain('Deposit');
    expect(content).toContain('Purchase');
    expect(budgetId).toBeTruthy();
  });
});
