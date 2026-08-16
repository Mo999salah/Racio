import { describe, expect, it } from 'vitest';
import { createFinancialAccount, createInstitution } from '../src/accounts';
import { AuthBoundaryError } from '../src/errors';

function mockInsertThrowing(error: unknown) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve([
              { id: 'inst-a', userId: 'user-a', name: 'Bank', normalizedName: 'bank' },
            ]),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.reject(error),
      }),
    }),
  };
}

function drizzleStyleUniqueViolation(constraintName: string): Error {
  const cause = Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint_name: constraintName,
    severity: 'ERROR',
  });
  return Object.assign(new Error('Failed query: insert into "financial_accounts" ...'), { cause });
}

describe('createFinancialAccount conflict mapping', () => {
  it('maps a wrapped Drizzle unique violation on the account constraint to CONFLICT', async () => {
    const error = drizzleStyleUniqueViolation('financial_accounts_user_institution_unique');
    await expect(
      createFinancialAccount(mockInsertThrowing(error) as never, 'user-a', {
        institutionId: 'inst-a',
        displayName: 'Duplicate',
        accountType: 'savings',
        currencyCode: 'USD',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' } satisfies Pick<AuthBoundaryError, 'code'>);
  });

  it('maps a direct PostgreSQL unique violation to CONFLICT', async () => {
    const error = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint_name: 'financial_accounts_user_institution_unique',
    });
    await expect(
      createFinancialAccount(mockInsertThrowing(error) as never, 'user-a', {
        institutionId: 'inst-a',
        displayName: 'Duplicate',
        accountType: 'savings',
        currencyCode: 'USD',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' } satisfies Pick<AuthBoundaryError, 'code'>);
  });

  it('does not map a non-unique PostgreSQL error to CONFLICT', async () => {
    const error = Object.assign(new Error('foreign key violation'), {
      code: '23503',
      constraint_name: 'financial_accounts_owner_institution_fk',
    });
    await expect(
      createFinancialAccount(mockInsertThrowing(error) as never, 'user-a', {
        institutionId: 'inst-a',
        displayName: 'X',
        accountType: 'checking',
        currencyCode: 'USD',
      }),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('does not map a generic Error to CONFLICT', async () => {
    await expect(
      createFinancialAccount(mockInsertThrowing(new Error('boom')) as never, 'user-a', {
        institutionId: 'inst-a',
        displayName: 'X',
        accountType: 'checking',
        currencyCode: 'USD',
      }),
    ).rejects.toThrow('boom');
  });

  it('does not map a unique violation on an unrelated constraint to the account CONFLICT', async () => {
    const error = drizzleStyleUniqueViolation('some_other_unique');
    await expect(
      createFinancialAccount(mockInsertThrowing(error) as never, 'user-a', {
        institutionId: 'inst-a',
        displayName: 'X',
        accountType: 'checking',
        currencyCode: 'USD',
      }),
    ).rejects.toMatchObject({ message: /Failed query/ });
  });
});

describe('createInstitution conflict mapping', () => {
  it('maps a wrapped Drizzle unique violation on the name constraint to CONFLICT', async () => {
    const error = drizzleStyleUniqueViolation('institutions_user_normalized_name_unique');
    await expect(
      createInstitution(mockInsertThrowing(error) as never, 'user-a', {
        name: 'Duplicate',
        countryCode: 'US',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' } satisfies Pick<AuthBoundaryError, 'code'>);
  });
});
