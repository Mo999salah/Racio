import { and, asc, desc, eq } from 'drizzle-orm';
import type {
  FinancialAccountCreate,
  FinancialAccountPatch,
  InstitutionCreate,
  InstitutionPatch,
} from '@racio/contracts';
import { normalizeInstitutionName } from '@racio/domain';
import { inspectPostgresError, schema, type RacioDatabase } from '@racio/database';
import { AuthBoundaryError } from './errors';

const PG_UNIQUE_VIOLATION = '23505';

const INSTITUTION_NAME_UNIQUE_CONSTRAINT = 'institutions_user_normalized_name_unique';
const ONE_ACCOUNT_PER_INSTITUTION_CONSTRAINT = 'financial_accounts_user_institution_unique';

function isInstitutionNameConflict(error: unknown): boolean {
  const info = inspectPostgresError(error);
  if (info.code !== PG_UNIQUE_VIOLATION) return false;
  // The insert/update targets institutions with a server-generated UUID id, so
  // the only realistic unique violation is the per-user normalized-name rule.
  return (
    info.constraintName === undefined || info.constraintName === INSTITUTION_NAME_UNIQUE_CONSTRAINT
  );
}

function isOneAccountPerInstitutionConflict(error: unknown): boolean {
  const info = inspectPostgresError(error);
  if (info.code !== PG_UNIQUE_VIOLATION) return false;
  // The insert targets financial_accounts with a server-generated UUID id, so
  // the only realistic unique violation is the one-account-per-institution rule.
  return (
    info.constraintName === undefined ||
    info.constraintName === ONE_ACCOUNT_PER_INSTITUTION_CONSTRAINT
  );
}

function ownedInstitutionWhere(userId: string, institutionId: string) {
  return and(eq(schema.institutions.id, institutionId), eq(schema.institutions.userId, userId));
}

function ownedAccountWhere(userId: string, accountId: string) {
  return and(
    eq(schema.financialAccounts.id, accountId),
    eq(schema.financialAccounts.userId, userId),
  );
}

function publicInstitution<T extends { userId: string }>(institution: T | undefined) {
  if (!institution) throw new Error('Database did not return the institution.');
  const { userId, ...safeInstitution } = institution;
  void userId;
  return safeInstitution;
}

function publicAccount<T extends { userId: string }>(account: T | undefined) {
  if (!account) throw new Error('Database did not return the account.');
  const { userId, ...safeAccount } = account;
  void userId;
  return safeAccount;
}

export async function listInstitutions(db: RacioDatabase, userId: string) {
  const rows = await db
    .select()
    .from(schema.institutions)
    .where(eq(schema.institutions.userId, userId))
    .orderBy(asc(schema.institutions.name));
  return rows.map(publicInstitution);
}

export async function getInstitution(db: RacioDatabase, userId: string, institutionId: string) {
  const [institution] = await db
    .select()
    .from(schema.institutions)
    .where(ownedInstitutionWhere(userId, institutionId))
    .limit(1);
  if (!institution) throw new AuthBoundaryError('NOT_FOUND', 'Institution not found.');
  return publicInstitution(institution);
}

export async function createInstitution(
  db: RacioDatabase,
  userId: string,
  input: InstitutionCreate,
) {
  const now = new Date();
  try {
    const [institution] = await db
      .insert(schema.institutions)
      .values({
        id: crypto.randomUUID(),
        userId,
        name: input.name.trim(),
        normalizedName: normalizeInstitutionName(input.name),
        countryCode: input.countryCode,
        websiteUrl: input.websiteUrl ?? null,
        logoUrl: input.logoUrl ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return publicInstitution(institution);
  } catch (error) {
    if (isInstitutionNameConflict(error)) {
      throw new AuthBoundaryError('CONFLICT', 'An institution with this name already exists.');
    }
    throw error;
  }
}

export async function updateInstitution(
  db: RacioDatabase,
  userId: string,
  institutionId: string,
  input: InstitutionPatch,
) {
  await getInstitution(db, userId, institutionId);
  const now = new Date();
  const values = {
    ...(input.name === undefined
      ? {}
      : { name: input.name.trim(), normalizedName: normalizeInstitutionName(input.name) }),
    ...(input.countryCode === undefined ? {} : { countryCode: input.countryCode }),
    ...(input.websiteUrl === undefined ? {} : { websiteUrl: input.websiteUrl ?? null }),
    ...(input.logoUrl === undefined ? {} : { logoUrl: input.logoUrl ?? null }),
    updatedAt: now,
  };
  try {
    const [institution] = await db
      .update(schema.institutions)
      .set(values)
      .where(ownedInstitutionWhere(userId, institutionId))
      .returning();
    return publicInstitution(institution);
  } catch (error) {
    if (isInstitutionNameConflict(error)) {
      throw new AuthBoundaryError('CONFLICT', 'An institution with this name already exists.');
    }
    throw error;
  }
}

export async function listFinancialAccounts(
  db: RacioDatabase,
  userId: string,
  includeArchived = false,
) {
  const conditions = [eq(schema.financialAccounts.userId, userId)];
  if (!includeArchived) conditions.push(eq(schema.financialAccounts.status, 'active'));
  return db
    .select({
      id: schema.financialAccounts.id,
      institutionId: schema.financialAccounts.institutionId,
      institutionName: schema.institutions.name,
      displayName: schema.financialAccounts.displayName,
      accountType: schema.financialAccounts.accountType,
      currencyCode: schema.financialAccounts.currencyCode,
      maskedAccountIdentifier: schema.financialAccounts.maskedAccountIdentifier,
      maskedIban: schema.financialAccounts.maskedIban,
      status: schema.financialAccounts.status,
      archivedAt: schema.financialAccounts.archivedAt,
      createdAt: schema.financialAccounts.createdAt,
      updatedAt: schema.financialAccounts.updatedAt,
    })
    .from(schema.financialAccounts)
    .innerJoin(
      schema.institutions,
      eq(schema.financialAccounts.institutionId, schema.institutions.id),
    )
    .where(and(...conditions))
    .orderBy(desc(schema.financialAccounts.updatedAt));
}

export async function getFinancialAccount(db: RacioDatabase, userId: string, accountId: string) {
  const [account] = await db
    .select()
    .from(schema.financialAccounts)
    .innerJoin(
      schema.institutions,
      eq(schema.financialAccounts.institutionId, schema.institutions.id),
    )
    .where(ownedAccountWhere(userId, accountId))
    .limit(1);
  if (!account) throw new AuthBoundaryError('NOT_FOUND', 'Financial account not found.');
  return publicAccount({
    ...account.financial_accounts,
    institutionName: account.institutions.name,
  });
}

export async function createFinancialAccount(
  db: RacioDatabase,
  userId: string,
  input: FinancialAccountCreate,
) {
  await getInstitution(db, userId, input.institutionId);
  const now = new Date();
  try {
    const [account] = await db
      .insert(schema.financialAccounts)
      .values({
        id: crypto.randomUUID(),
        userId,
        institutionId: input.institutionId,
        displayName: input.displayName.trim(),
        accountType: input.accountType,
        currencyCode: input.currencyCode,
        maskedAccountIdentifier: input.maskedAccountIdentifier ?? null,
        maskedIban: input.maskedIban ?? null,
        status: 'active',
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return publicAccount(account);
  } catch (error) {
    if (isOneAccountPerInstitutionConflict(error)) {
      throw new AuthBoundaryError('CONFLICT', 'This institution already has an account.');
    }
    throw error;
  }
}

export async function updateFinancialAccount(
  db: RacioDatabase,
  userId: string,
  accountId: string,
  input: FinancialAccountPatch,
) {
  await getFinancialAccount(db, userId, accountId);
  const values = {
    ...(input.displayName === undefined ? {} : { displayName: input.displayName.trim() }),
    ...(input.accountType === undefined ? {} : { accountType: input.accountType }),
    ...(input.currencyCode === undefined ? {} : { currencyCode: input.currencyCode }),
    ...(input.maskedAccountIdentifier === undefined
      ? {}
      : { maskedAccountIdentifier: input.maskedAccountIdentifier ?? null }),
    ...(input.maskedIban === undefined ? {} : { maskedIban: input.maskedIban ?? null }),
    updatedAt: new Date(),
  };
  const [account] = await db
    .update(schema.financialAccounts)
    .set(values)
    .where(ownedAccountWhere(userId, accountId))
    .returning();
  return publicAccount(account);
}

export async function archiveFinancialAccount(
  db: RacioDatabase,
  userId: string,
  accountId: string,
) {
  await getFinancialAccount(db, userId, accountId);
  const [account] = await db
    .update(schema.financialAccounts)
    .set({ status: 'archived', archivedAt: new Date(), updatedAt: new Date() })
    .where(ownedAccountWhere(userId, accountId))
    .returning();
  return publicAccount(account);
}

export async function restoreFinancialAccount(
  db: RacioDatabase,
  userId: string,
  accountId: string,
) {
  await getFinancialAccount(db, userId, accountId);
  const [account] = await db
    .update(schema.financialAccounts)
    .set({ status: 'active', archivedAt: null, updatedAt: new Date() })
    .where(ownedAccountWhere(userId, accountId))
    .returning();
  return publicAccount(account);
}
