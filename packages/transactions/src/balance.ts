import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { decimalToScaledInteger, scaledIntegerToDecimal } from '@racio/domain';
import { schema, type RacioDatabase } from '@racio/database';
import { AuthBoundaryError } from '@racio/auth';

/**
 * Single authoritative resolver for the latest known account balance.
 *
 * Precedence (deterministic, no transaction-sum fallback):
 *
 * 1. latest confirmed transaction `balance_after` for the account (ordered by
 *    booking date, then creation time, then id)
 * 2. otherwise the latest confirmed statement `closing_balance` (ordered by
 *    period end, then confirmation time, then id)
 * 3. otherwise null (balance unavailable)
 *
 * Confirmed/final data only, owned account only, and same account currency.
 * Consumed by both Phase 9 dashboard account reporting and Phase 10
 * account-balance savings goals so they can never disagree.
 */

export type KnownBalanceSource = 'transaction_balance_after' | 'statement_closing_balance';

export type KnownBalance = {
  amount: string;
  currency: string;
  asOfDate: string;
  source: KnownBalanceSource;
  sourceId: string;
};

function normalize(value: string): string {
  return scaledIntegerToDecimal(decimalToScaledInteger(value));
}

function notFound(message: string): never {
  throw new AuthBoundaryError('NOT_FOUND', message);
}

export async function resolveAccountKnownBalance(
  db: RacioDatabase,
  userId: string,
  accountId: string,
): Promise<KnownBalance | null> {
  const [account] = await db
    .select({
      id: schema.financialAccounts.id,
      currencyCode: schema.financialAccounts.currencyCode,
    })
    .from(schema.financialAccounts)
    .where(
      and(eq(schema.financialAccounts.id, accountId), eq(schema.financialAccounts.userId, userId)),
    )
    .limit(1);
  if (!account) notFound('Financial account not found.');
  const currency = account.currencyCode;

  const [transaction] = await db
    .select({
      balanceAfter: schema.transactions.balanceAfter,
      bookingDate: schema.transactions.bookingDate,
      id: schema.transactions.id,
    })
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.userId, userId),
        eq(schema.transactions.financialAccountId, accountId),
        eq(schema.transactions.status, 'confirmed'),
        eq(schema.transactions.currencyCode, currency),
        isNotNull(schema.transactions.balanceAfter),
      ),
    )
    .orderBy(
      desc(schema.transactions.bookingDate),
      desc(schema.transactions.createdAt),
      desc(schema.transactions.id),
    )
    .limit(1);

  if (transaction?.balanceAfter != null) {
    return {
      amount: normalize(transaction.balanceAfter),
      currency,
      asOfDate: transaction.bookingDate,
      source: 'transaction_balance_after',
      sourceId: transaction.id,
    };
  }

  const [statement] = await db
    .select({
      closingBalance: schema.statements.closingBalance,
      periodEnd: schema.statements.periodEnd,
      confirmedAt: schema.statements.confirmedAt,
      id: schema.statements.id,
    })
    .from(schema.statements)
    .where(
      and(
        eq(schema.statements.userId, userId),
        eq(schema.statements.financialAccountId, accountId),
        isNotNull(schema.statements.confirmedAt),
        isNotNull(schema.statements.closingBalance),
      ),
    )
    .orderBy(
      sql`${schema.statements.periodEnd} desc nulls last, ${schema.statements.confirmedAt} desc, ${schema.statements.id} desc`,
    )
    .limit(1);

  if (statement?.closingBalance != null) {
    return {
      amount: normalize(statement.closingBalance),
      currency,
      asOfDate: statement.periodEnd ?? statement.confirmedAt!.toISOString().slice(0, 10),
      source: 'statement_closing_balance',
      sourceId: statement.id,
    };
  }

  return null;
}
