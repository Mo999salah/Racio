import { and, count, eq, gte, isNull, lte, notExists, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { scaledIntegerToDecimal, decimalToScaledInteger } from '@racio/domain';
import { schema, type RacioDatabase } from '@racio/database';

/**
 * Shared expense-spending predicate for budgets. It intentionally reuses the
 * Phase 9 dashboard allocation semantics:
 *
 * - confirmed transactions only (archived transactions are excluded)
 * - debit (expense) direction only
 * - confirmed internal transfers are excluded
 * - active splits replace the parent category allocation (archived split
 *   versions are ignored); the parent amount is never counted twice
 *
 * This is the single source of truth consumed by both the budget status UI and
 * the budget alert evaluation so a worker can never disagree with the UI.
 */

export type ExpenseSpendingScope = {
  currency: string;
  from: string;
  to: string;
  accountId?: string;
};

export type ExpenseSpendingCategoryRow = {
  categoryId: string | null;
  amount: string;
};

export type ExpenseSpending = {
  currency: string;
  total: string;
  byCategory: ExpenseSpendingCategoryRow[];
};

function trimNumeric(value: string | null | undefined): string {
  if (value == null) return '0';
  const text = value.trim();
  if (text === '' || text === '0') return '0';
  const negative = text.startsWith('-');
  const absolute = negative ? text.slice(1) : text;
  const [whole, fraction] = absolute.split('.');
  let result = whole || '0';
  if (fraction && /[1-9]/u.test(fraction)) result += `.${fraction.replace(/0+$/u, '')}`;
  return negative ? `-${result}` : result;
}

function categoryIdExpression() {
  return sql<string | null>`(
    CASE
      WHEN ${schema.transactionSplits.id} IS NOT NULL
      THEN ${schema.transactionSplitCategoryAssignments.categoryId}
      ELSE ${schema.transactionCategoryAssignments.categoryId}
    END
  )`;
}

function categoryAmountExpression() {
  return sql<string>`sum(
    CASE
      WHEN ${schema.transactionSplits.id} IS NOT NULL
      THEN ${schema.transactionSplits.amount}
      ELSE ${schema.transactions.amount}
    END
  )`;
}

export async function getExpenseSpending(
  db: RacioDatabase,
  userId: string,
  scope: ExpenseSpendingScope,
): Promise<ExpenseSpending> {
  const conditions: SQL[] = [
    eq(schema.transactions.userId, userId),
    eq(schema.transactions.status, 'confirmed'),
    eq(schema.transactions.direction, 'debit'),
    eq(schema.transactions.currencyCode, scope.currency),
    gte(schema.transactions.bookingDate, scope.from),
    lte(schema.transactions.bookingDate, scope.to),
  ];
  if (scope.accountId) conditions.push(eq(schema.transactions.financialAccountId, scope.accountId));

  const confirmedTransferNotExists = notExists(
    db
      .select({ id: schema.internalTransferLinks.id })
      .from(schema.internalTransferLinks)
      .where(
        and(
          eq(schema.internalTransferLinks.userId, userId),
          eq(schema.internalTransferLinks.status, 'confirmed'),
          or(
            eq(schema.internalTransferLinks.outgoingTransactionId, schema.transactions.id),
            eq(schema.internalTransferLinks.incomingTransactionId, schema.transactions.id),
          )!,
        ),
      ),
  );

  const rows = await db
    .select({
      categoryId: categoryIdExpression(),
      amount: categoryAmountExpression(),
    })
    .from(schema.transactions)
    .leftJoin(
      schema.transactionSplits,
      and(
        eq(schema.transactionSplits.transactionId, schema.transactions.id),
        eq(schema.transactionSplits.userId, userId),
        isNull(schema.transactionSplits.archivedAt),
      ),
    )
    .leftJoin(
      schema.transactionSplitCategoryAssignments,
      and(
        eq(schema.transactionSplitCategoryAssignments.splitId, schema.transactionSplits.id),
        eq(schema.transactionSplitCategoryAssignments.userId, userId),
        eq(schema.transactionSplitCategoryAssignments.role, 'primary'),
      ),
    )
    .leftJoin(
      schema.transactionCategoryAssignments,
      and(
        eq(schema.transactionCategoryAssignments.transactionId, schema.transactions.id),
        eq(schema.transactionCategoryAssignments.userId, userId),
        eq(schema.transactionCategoryAssignments.role, 'primary'),
      ),
    )
    .where(and(...conditions, confirmedTransferNotExists))
    .groupBy(categoryIdExpression());

  const byCategory: ExpenseSpendingCategoryRow[] = rows.map((row) => ({
    categoryId: row.categoryId,
    amount: trimNumeric(row.amount),
  }));

  let totalScaled = 0n;
  for (const row of byCategory) totalScaled += decimalToScaledInteger(row.amount);
  const total = scaledIntegerToDecimal(totalScaled);

  return { currency: scope.currency, total, byCategory };
}

export type UncategorizedAllocation = {
  currency: string;
  count: number;
  amount: string;
};

/**
 * Reporting-level uncategorized expense allocations, split-aware and
 * transfer-excluded. An uncategorized allocation is either an unsplit confirmed
 * debit with no primary category, or an active split allocation with no primary
 * category. Archived split versions are ignored and confirmed internal
 * transfers are excluded; suggested/rejected transfers remain ordinary.
 * Amounts are returned per currency and are never combined.
 */
export async function getUncategorizedExpenseAllocations(
  db: RacioDatabase,
  userId: string,
): Promise<UncategorizedAllocation[]> {
  const confirmedTransferNotExists = notExists(
    db
      .select({ id: schema.internalTransferLinks.id })
      .from(schema.internalTransferLinks)
      .where(
        and(
          eq(schema.internalTransferLinks.userId, userId),
          eq(schema.internalTransferLinks.status, 'confirmed'),
          or(
            eq(schema.internalTransferLinks.outgoingTransactionId, schema.transactions.id),
            eq(schema.internalTransferLinks.incomingTransactionId, schema.transactions.id),
          )!,
        ),
      ),
  );

  const rows = await db
    .select({
      currency: schema.transactions.currencyCode,
      count: count(),
      amount: sql<string>`sum(
        CASE
          WHEN ${schema.transactionSplits.id} IS NOT NULL
          THEN ${schema.transactionSplits.amount}
          ELSE ${schema.transactions.amount}
        END
      )`,
    })
    .from(schema.transactions)
    .leftJoin(
      schema.transactionSplits,
      and(
        eq(schema.transactionSplits.transactionId, schema.transactions.id),
        eq(schema.transactionSplits.userId, userId),
        isNull(schema.transactionSplits.archivedAt),
      ),
    )
    .leftJoin(
      schema.transactionSplitCategoryAssignments,
      and(
        eq(schema.transactionSplitCategoryAssignments.splitId, schema.transactionSplits.id),
        eq(schema.transactionSplitCategoryAssignments.userId, userId),
        eq(schema.transactionSplitCategoryAssignments.role, 'primary'),
      ),
    )
    .leftJoin(
      schema.transactionCategoryAssignments,
      and(
        eq(schema.transactionCategoryAssignments.transactionId, schema.transactions.id),
        eq(schema.transactionCategoryAssignments.userId, userId),
        eq(schema.transactionCategoryAssignments.role, 'primary'),
      ),
    )
    .where(
      and(
        eq(schema.transactions.userId, userId),
        eq(schema.transactions.status, 'confirmed'),
        eq(schema.transactions.direction, 'debit'),
        confirmedTransferNotExists,
        sql`(CASE
          WHEN ${schema.transactionSplits.id} IS NOT NULL
          THEN ${schema.transactionSplitCategoryAssignments.categoryId}
          ELSE ${schema.transactionCategoryAssignments.categoryId}
        END) IS NULL`,
      ),
    )
    .groupBy(schema.transactions.currencyCode);

  return rows.map((row) => ({
    currency: row.currency,
    count: Number(row.count),
    amount: trimNumeric(row.amount),
  }));
}
