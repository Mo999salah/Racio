import { expect, test } from '@playwright/test';
import {
  confirmFromReview,
  createAccountViaApi,
  signInAs,
  uniqueEmail,
  uploadStatement,
  waitForImportStatus,
} from './helpers';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/statements');

test.describe('statement imports', () => {
  test('CSV import: upload, review, confirm, and land on the summary', async ({ page }) => {
    await signInAs(page, uniqueEmail());
    const { accountId } = await createAccountViaApi(page);
    const statementId = await uploadStatement(page, `${FIXTURES}/csv/debit-credit.csv`, accountId);
    await waitForImportStatus(page, statementId, ['needs_review', 'ready']);
    await confirmFromReview(page, statementId);
  });

  test('XLSX import: single-sheet workbook confirms through the same pipeline', async ({
    page,
  }) => {
    await signInAs(page, uniqueEmail());
    const { accountId } = await createAccountViaApi(page);
    const statementId = await uploadStatement(
      page,
      `${FIXTURES}/xlsx/english-one-sheet.xlsx`,
      accountId,
    );
    await waitForImportStatus(page, statementId, ['needs_review', 'ready']);
    await confirmFromReview(page, statementId);
  });

  test('text-PDF import confirms; image-only PDF is rejected as unsupported', async ({ page }) => {
    await signInAs(page, uniqueEmail());
    const { accountId } = await createAccountViaApi(page);

    const scannedId = await uploadStatement(page, `${FIXTURES}/pdf/image-only.pdf`, accountId);
    await waitForImportStatus(page, scannedId, ['failed']);
    const failed = await page.request.get(`/api/imports/${scannedId}`, {
      headers: { cache: 'no-store' },
    });
    const failedBody = (await failed.json()) as { lastErrorCode?: string };
    expect(failedBody.lastErrorCode).toMatch(/PDF_/u);

    const textId = await uploadStatement(page, `${FIXTURES}/pdf/english-statement.pdf`, accountId);
    await waitForImportStatus(page, textId, ['needs_review', 'ready']);
    await confirmFromReview(page, textId);
  });
});
