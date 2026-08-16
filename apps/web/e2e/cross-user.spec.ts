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

test.describe('cross-user isolation', () => {
  test('a second user receives not-found for the first user owned resources', async ({ page }) => {
    // User A owns everything.
    await signInAs(page, uniqueEmail('owner'));
    const { accountId } = await createAccountViaApi(page, 'Owner Bank', 'USD');
    const statementId = await uploadStatement(page, `${FIXTURES}/csv/debit-credit.csv`, accountId);
    await waitForImportStatus(page, statementId, ['needs_review', 'ready']);
    await confirmImportViaApi(page, statementId);
    const transactions = await page.request.get('/api/transactions?limit=5');
    expect(transactions.status()).toBe(200);
    const transactionsBody = (await transactions.json()) as { items?: { id: string }[] };
    expect(transactionsBody.items?.length).toBeGreaterThan(0);
    const transactionId = transactionsBody.items![0]!.id;
    const budgetId = await createBudgetViaApi(page, 'USD', '500.00', 'Owner Budget');
    const exportResponse = await page.request.post('/api/exports', {
      data: {
        type: 'transactions_csv',
        filters: { includeArchived: 'false' },
        includeNotes: false,
      },
    });
    expect(exportResponse.status()).toBe(201);
    const exportId = ((await exportResponse.json()) as { id: string }).id;

    // User B cannot reach any of it.
    await signInAs(page, uniqueEmail('intruder'));
    const attempts: Array<[string, string]> = [
      ['GET', `/api/accounts/${accountId}`],
      ['GET', `/api/imports/${statementId}`],
      ['GET', `/api/transactions/${transactionId}`],
      ['GET', `/api/budgets/${budgetId}`],
      ['GET', `/api/exports/${exportId}`],
      ['GET', `/api/exports/${exportId}/download`],
    ];
    for (const [method, url] of attempts) {
      const response = await page.request.fetch(url, { method });
      expect(response.status(), `${method} ${url} should deny`).toBe(404);
    }

    // The intruder's own data surface is empty and functional.
    const ownAccounts = await page.request.get('/api/accounts');
    expect(((await ownAccounts.json()) as unknown[]).length).toBe(0);
  });
});
