import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';

/** Unique disposable user per test run; emails never collide. */
export function uniqueEmail(prefix = 'e2e') {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
}

export type TestUser = { email: string; userId: string };

/**
 * Creates a real Better Auth database session for the user and returns it.
 * The session cookie is already stored in the browser context.
 */
export async function signInAs(page: Page, email: string): Promise<TestUser> {
  const response = await page.request.post('/api/test/session', { data: { email } });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { userId: string };
  // The Set-Cookie from the raw response is applied to the shared context of
  // the page, so subsequent page loads carry the session.
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((cookie) => cookie.name === 'better-auth.session_token');
  expect(sessionCookie, 'session cookie should be set').toBeTruthy();
  return { email, userId: body.userId };
}

/** Creates an institution and a financial account through the public API. */
export async function createAccountViaApi(
  page: Page,
  name = 'E2E Bank',
  currency = 'USD',
): Promise<{ institutionId: string; accountId: string }> {
  const institution = await page.request.post('/api/institutions', {
    data: { name, countryCode: 'US' },
  });
  expect(institution.status(), await institution.text()).toBe(201);
  const institutionBody = (await institution.json()) as { id: string };
  const account = await page.request.post('/api/accounts', {
    data: {
      institutionId: institutionBody.id,
      displayName: 'Checking',
      accountType: 'checking',
      currencyCode: currency,
      maskedAccountIdentifier: '****1234',
    },
  });
  expect(account.status(), await account.text()).toBe(201);
  const accountBody = (await account.json()) as { id: string };
  return { institutionId: institutionBody.id, accountId: accountBody.id };
}

/** Waits for an import to reach a terminal or review state via the API. */
export async function waitForImportStatus(
  page: Page,
  statementId: string,
  statuses: string[],
  attempts = 60,
): Promise<string> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await page.request.get(`/api/imports/${statementId}`, {
      headers: { cache: 'no-store' },
    });
    if (response.status() === 200) {
      const body = (await response.json()) as { processingStatus: string };
      if (statuses.includes(body.processingStatus)) return body.processingStatus;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`import ${statementId} did not reach ${statuses.join('|')}`);
}

/**
 * Drives the review page to confirmation: excludes duplicate-candidate rows,
 * marks remaining attention rows reviewed, then confirms.
 */
export async function confirmFromReview(page: Page, statementId: string, locale = 'en') {
  await page.goto(`/${locale}/imports/${statementId}/review`);
  await expect(page.locator('.review-row').first()).toBeVisible({ timeout: 20_000 });
  const exclude = page.getByRole('button', { name: /exclude/i }).first();
  for (
    let attempt = 0;
    attempt < 10 && (await exclude.isVisible().catch(() => false));
    attempt += 1
  ) {
    await exclude.click();
    await page.waitForTimeout(400);
  }
  const markAll = page.getByRole('button', { name: /mark all reviewed/i });
  if (await markAll.isVisible().catch(() => false)) {
    await markAll.click();
    await page.waitForTimeout(500);
  }
  const confirm = page.getByRole('button', { name: /confirm import/i });
  await expect(confirm).toBeVisible({ timeout: 20_000 });
  await confirm.click();
  await page.waitForURL(new RegExp(`/${locale}/imports/${statementId}/summary`));
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

export async function uploadStatement(
  page: Page,
  filePath: string,
  accountId: string,
): Promise<string> {
  const buffer = await readFile(filePath);
  const extension = filePath.split('.').pop() ?? 'csv';
  const mimeType =
    extension === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : extension === 'pdf'
        ? 'application/pdf'
        : 'text/csv';
  const response = await page.request.post('/api/imports', {
    multipart: {
      file: { name: filePath.split(/[\\/]/).pop() ?? 'statement.csv', mimeType, buffer },
      accountId,
      retainOriginalFile: 'false',
      reprocess: 'false',
      idempotencyKey: randomUUID(),
    },
  });
  expect(response.status(), await response.text()).toBeGreaterThanOrEqual(200);
  expect(response.status(), await response.text()).toBeLessThan(300);
  const body = (await response.json()) as { statement: { id: string } };
  return body.statement.id;
}

/**
 * Resolves every attention row (duplicates excluded, the rest marked
 * reviewed) and confirms the import through the API.
 */
export async function confirmImportViaApi(page: Page, statementId: string) {
  const reviewResponse = await page.request.get(`/api/imports/${statementId}/review`);
  expect(reviewResponse.status()).toBe(200);
  const rows = (await reviewResponse.json()) as Array<{
    id: string;
    reviewStatus: string;
    bookingDate: string | null;
    rawDescription: string;
    amount: string | null;
    currencyCode: string | null;
    direction: string | null;
  }>;
  for (const row of rows) {
    if (row.reviewStatus === 'valid' || row.reviewStatus === 'excluded') continue;
    const patch = await page.request.patch(`/api/imports/${statementId}/rows/${row.id}`, {
      data: {
        action: row.reviewStatus === 'duplicate_candidate' ? 'exclude' : 'mark-reviewed',
        bookingDate: row.bookingDate,
        description: row.rawDescription,
        amount: row.amount,
        currency: row.currencyCode,
        direction: row.direction,
      },
    });
    expect(patch.status(), await patch.text()).toBe(200);
  }
  const confirm = await page.request.post(`/api/imports/${statementId}/confirm`, {
    data: {
      confirmMismatch: false,
      idempotencyKey: `e2e-confirm-${Date.now()}-${randomUUID().slice(0, 6)}`,
    },
  });
  expect(confirm.status(), await confirm.text()).toBe(200);
}

/** Creates a budget through the public API. */
export async function createBudgetViaApi(
  page: Page,
  currency = 'USD',
  amount = '500.00',
  name = 'E2E Budget',
): Promise<string> {
  const response = await page.request.post('/api/budgets', {
    data: { name, currency, amount, period: 'monthly' },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}
