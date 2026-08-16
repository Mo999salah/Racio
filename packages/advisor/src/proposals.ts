import { and, eq, inArray } from 'drizzle-orm';
import { advisorProposalSchema, type AdvisorProposal } from '@racio/contracts';
import { AuthBoundaryError } from '@racio/auth';
import { schema, type RacioDatabase } from '@racio/database';
import { createBudget, currentPeriodBounds, todayForTimeZone } from '@racio/planning';
import { bulkUpdateTransactions, getExpenseSpending } from '@racio/transactions';
import { AiError } from '@racio/ai';
import {
  createProposal,
  getOwnedProposal,
  markProposalExecuted,
  markProposalExpired,
} from './persistence';

/**
 * Mutation proposals: the advisor may only propose a change; nothing is
 * executed until the server validates the proposal, the user confirms it
 * explicitly, and the existing domain mutation service runs. Proposals are
 * server-stored with an expiry, so confirmation revalidates the stored payload
 * and never trusts a client-resubmitted AI JSON blob.
 */

export const PROPOSAL_TTL_MS = 30 * 60 * 1000;

function notFound(message: string): never {
  throw new AuthBoundaryError('NOT_FOUND', message);
}

function conflict(message: string): never {
  throw new AuthBoundaryError('CONFLICT', message);
}

function validation(message: string): never {
  throw new AuthBoundaryError('VALIDATION', message);
}

async function ownedActiveCategory(db: RacioDatabase, userId: string, categoryId: string) {
  const [row] = await db
    .select({ id: schema.categories.id, status: schema.categories.status })
    .from(schema.categories)
    .where(and(eq(schema.categories.id, categoryId), eq(schema.categories.userId, userId)))
    .limit(1);
  if (!row) notFound('Category not found.');
  if (row.status !== 'active') conflict('Only active categories can be used.');
}

async function ownedAccountForBudget(
  db: RacioDatabase,
  userId: string,
  accountId: string,
  currency: string,
) {
  const [row] = await db
    .select({
      id: schema.financialAccounts.id,
      status: schema.financialAccounts.status,
      currencyCode: schema.financialAccounts.currencyCode,
    })
    .from(schema.financialAccounts)
    .where(
      and(eq(schema.financialAccounts.id, accountId), eq(schema.financialAccounts.userId, userId)),
    )
    .limit(1);
  if (!row) notFound('Financial account not found.');
  if (row.status !== 'active') conflict('Only active accounts can be used by a budget.');
  if (row.currencyCode !== currency)
    validation('The budget currency must match the account currency.');
}

function validateProposalPayload(value: unknown): AdvisorProposal {
  const parsed = advisorProposalSchema.safeParse(value);
  if (!parsed.success) throw new AiError('AI_UNSAFE_PROPOSAL');
  if (parsed.data.type === 'create_budget' && parsed.data.period === 'custom') {
    if (!parsed.data.startDate || !parsed.data.endDate)
      validation('A custom budget period requires start and end dates.');
    if (parsed.data.startDate! > parsed.data.endDate!)
      validation('The end date must follow the start date.');
  }
  return parsed.data;
}

export async function createAdvisorProposal(
  db: RacioDatabase,
  userId: string,
  proposal: unknown,
  timeZone: string,
) {
  const validated = validateProposalPayload(proposal);
  if (validated.type === 'categorize_transactions') {
    await ownedActiveCategory(db, userId, validated.categoryId);
    const ids = [...new Set(validated.transactionIds)];
    const owned = await db
      .select({ id: schema.transactions.id })
      .from(schema.transactions)
      .where(and(eq(schema.transactions.userId, userId), inArray(schema.transactions.id, ids)));
    if (owned.length !== ids.length) notFound('One or more transactions were not found.');
  } else {
    if (validated.categoryId) await ownedActiveCategory(db, userId, validated.categoryId);
    if (validated.accountId)
      await ownedAccountForBudget(db, userId, validated.accountId, validated.currency);
  }

  const preview = await buildProposalPreview(db, userId, validated, timeZone);
  const stored = await createProposal(
    db,
    userId,
    validated.type,
    validated,
    new Date(Date.now() + PROPOSAL_TTL_MS),
  );

  return { proposalId: stored.id, proposal: validated, preview };
}

async function buildProposalPreview(
  db: RacioDatabase,
  userId: string,
  proposal: AdvisorProposal,
  timeZone: string,
) {
  if (proposal.type === 'categorize_transactions') {
    const ids = [...new Set(proposal.transactionIds)];
    const rows = await db
      .select({
        id: schema.transactions.id,
        bookingDate: schema.transactions.bookingDate,
        amount: schema.transactions.amount,
        currencyCode: schema.transactions.currencyCode,
      })
      .from(schema.transactions)
      .where(and(eq(schema.transactions.userId, userId), inArray(schema.transactions.id, ids)))
      .orderBy(schema.transactions.bookingDate);
    const [category] = await db
      .select({ id: schema.categories.id, name: schema.categories.name })
      .from(schema.categories)
      .where(
        and(eq(schema.categories.id, proposal.categoryId), eq(schema.categories.userId, userId)),
      )
      .limit(1);
    return {
      type: 'categorize_transactions' as const,
      count: ids.length,
      categoryName: category?.name ?? null,
      sample: rows.slice(0, 10).map((row) => ({
        id: row.id,
        bookingDate: row.bookingDate,
        amount: row.amount,
        currency: row.currencyCode,
      })),
    };
  }

  // create_budget: show the deterministic current-period spending the budget
  // would report, using the exact shared expense predicate the budget UI uses.
  const today = todayForTimeZone(timeZone);
  const bounds = currentPeriodBounds(
    proposal.period,
    today,
    proposal.period === 'custom' ? (proposal.startDate ?? null) : null,
    proposal.period === 'custom' ? (proposal.endDate ?? null) : null,
  );
  const spending = await getExpenseSpending(db, userId, {
    currency: proposal.currency,
    from: bounds.start,
    to: bounds.end,
    accountId: proposal.accountId ?? undefined,
  });
  const scoped =
    proposal.categoryId === null || proposal.categoryId === undefined
      ? spending.total
      : (spending.byCategory.find((row) => row.categoryId === proposal.categoryId)?.amount ?? '0');
  return {
    type: 'create_budget' as const,
    currency: proposal.currency,
    amount: proposal.amount,
    period: proposal.period,
    periodStart: bounds.start,
    periodEnd: bounds.end,
    currentSpent: scoped,
    warningThreshold: proposal.warningThreshold ?? null,
  };
}

export type ConfirmProposalResult = {
  proposalId: string;
  type: string;
  result: unknown;
  idempotent: boolean;
  needsAlertEvaluation: boolean;
};

export async function confirmAdvisorProposal(
  db: RacioDatabase,
  userId: string,
  proposalId: string,
): Promise<ConfirmProposalResult> {
  const stored = await getOwnedProposal(db, userId, proposalId);
  if (!stored) notFound('Proposal not found.');

  if (stored.status === 'expired' || stored.status === 'cancelled') {
    throw new AiError('AI_STALE_PROPOSAL');
  }
  if (stored.status === 'executed') {
    return {
      proposalId: stored.id,
      type: stored.type,
      result: stored.result,
      idempotent: true,
      needsAlertEvaluation: false,
    };
  }
  if (Date.now() > stored.expiresAt.getTime()) {
    await markProposalExpired(db, userId, proposalId);
    throw new AiError('AI_STALE_PROPOSAL');
  }

  const proposal = validateProposalPayload(stored.payload);
  let result: unknown;
  let needsAlertEvaluation = false;

  if (proposal.type === 'categorize_transactions') {
    await ownedActiveCategory(db, userId, proposal.categoryId);
    result = await bulkUpdateTransactions(db, userId, {
      transactionIds: proposal.transactionIds,
      action: 'set-primary-category',
      categoryId: proposal.categoryId,
    });
  } else {
    if (proposal.categoryId) await ownedActiveCategory(db, userId, proposal.categoryId);
    if (proposal.accountId)
      await ownedAccountForBudget(db, userId, proposal.accountId, proposal.currency);
    const budget = await createBudget(db, userId, {
      name: proposal.name,
      currency: proposal.currency,
      amount: proposal.amount,
      period: proposal.period,
      categoryId: proposal.categoryId ?? null,
      accountId: proposal.accountId ?? null,
      startDate: proposal.period === 'custom' ? (proposal.startDate ?? null) : null,
      endDate: proposal.period === 'custom' ? (proposal.endDate ?? null) : null,
      warningThreshold: proposal.warningThreshold ?? null,
      rolloverEnabled: proposal.rolloverEnabled,
      enabled: true,
    });
    result = { budget };
    needsAlertEvaluation = true;
  }

  await markProposalExecuted(db, userId, proposalId, result);
  return {
    proposalId,
    type: proposal.type,
    result,
    idempotent: false,
    needsAlertEvaluation,
  };
}
