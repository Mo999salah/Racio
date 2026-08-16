import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDatabase, schema, type RacioDatabase } from '@racio/database';
import {
  archiveFinancialAccount,
  createFinancialAccount,
  createInstitution,
  getFinancialAccount,
  listFinancialAccounts,
  restoreFinancialAccount,
} from '../src/accounts';
import { AuthBoundaryError } from '../src/errors';

const runIntegration = process.env.RACIO_RUN_DB_INTEGRATION === '1';
const suite = runIntegration ? describe : describe.skip;

suite('financial account ownership integration', () => {
  let db: RacioDatabase;
  let client: ReturnType<typeof createDatabase>['client'];
  const userA = `phase3-user-a-${crypto.randomUUID()}`;
  const userB = `phase3-user-b-${crypto.randomUUID()}`;
  let institutionId = '';
  let accountId = '';

  beforeAll(async () => {
    ({ db, client } = createDatabase(
      process.env.DATABASE_URL ?? 'postgresql://racio:racio_dev@localhost:5432/racio',
    ));
    const now = new Date();
    await db.insert(schema.user).values([
      {
        id: userA,
        name: 'Phase 3 A',
        email: `${userA}@example.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: userB,
        name: 'Phase 3 B',
        email: `${userB}@example.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const institution = await createInstitution(db, userA, {
      name: 'Integration Bank',
      countryCode: 'TR',
    });
    institutionId = institution.id;
    const account = await createFinancialAccount(db, userA, {
      institutionId,
      displayName: 'Main account',
      accountType: 'checking',
      currencyCode: 'TRY',
      maskedAccountIdentifier: '•••• 1234',
    });
    accountId = account.id;
  });

  afterAll(async () => {
    await db.delete(schema.financialAccounts).where(eq(schema.financialAccounts.id, accountId));
    await db.delete(schema.institutions).where(eq(schema.institutions.id, institutionId));
    await db.delete(schema.user).where(eq(schema.user.id, userA));
    await db.delete(schema.user).where(eq(schema.user.id, userB));
    await client.end();
  });

  it("does not expose or mutate another user's account", async () => {
    await expect(getFinancialAccount(db, userB, accountId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      createFinancialAccount(db, userB, {
        institutionId,
        displayName: 'Cross-user attempt',
        accountType: 'cash',
        currencyCode: 'TRY',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('enforces one account per institution and supports archive/restore', async () => {
    await expect(
      createFinancialAccount(db, userA, {
        institutionId,
        displayName: 'Duplicate attempt',
        accountType: 'savings',
        currencyCode: 'TRY',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' } satisfies Pick<AuthBoundaryError, 'code'>);

    await archiveFinancialAccount(db, userA, accountId);
    expect(await listFinancialAccounts(db, userA)).toHaveLength(0);
    expect(await listFinancialAccounts(db, userA, true)).toHaveLength(1);
    await restoreFinancialAccount(db, userA, accountId);
    expect(await listFinancialAccounts(db, userA)).toHaveLength(1);
  });

  it('lets a different user create their own account for their own institution', async () => {
    const otherInstitution = await createInstitution(db, userB, {
      name: 'Second Integration Bank',
      countryCode: 'TR',
    });
    const otherAccount = await createFinancialAccount(db, userB, {
      institutionId: otherInstitution.id,
      displayName: 'B account',
      accountType: 'checking',
      currencyCode: 'TRY',
    });
    expect(otherAccount.id).toBeTruthy();
    expect(otherAccount.displayName).toBe('B account');
    await db
      .delete(schema.financialAccounts)
      .where(eq(schema.financialAccounts.id, otherAccount.id));
    await db.delete(schema.institutions).where(eq(schema.institutions.id, otherInstitution.id));
  });
});
