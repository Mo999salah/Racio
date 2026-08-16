import { and, eq } from 'drizzle-orm';
import type { AiRuntime } from '@racio/ai';
import { AiError } from '@racio/ai';
import { AuthBoundaryError } from '@racio/auth';
import { schema, type RacioDatabase } from '@racio/database';
import type { AdvisorContext, AdvisorQuery, UserPreferences } from '@racio/contracts';
import {
  buildClarificationOptions,
  previousRangeOf,
  type ClarificationOption,
  type ClarificationOptionId,
  type ResolvedDateRange,
} from './date';
import {
  alertsDrilldown,
  budgetsDrilldown,
  goalsDrilldown,
  importsDrilldown,
  reconciliationDrilldown,
  renderAnswer,
  transactionsDrilldown,
  type AdvisorFact,
  type Drilldown,
} from './facts';
import { generateExplanation } from './provider-call';
import { planAdvisorRequest, topicRequiresDateRange } from './planner';
import { appendMessage, createThread } from './persistence';
import type { RateLimiter } from './rate-limit';
import { executeTool, isToolName, type ToolContext, type ToolLimits, type ToolName } from './tools';

export type AdvisorStrings = {
  unsupported: string;
  clarificationMessage: string;
  clarificationOptions: Record<ClarificationOptionId, string>;
  /** Deterministic no-data response used when the planned tools find nothing. */
  noData: string;
};

const MAX_FACTS = 60;
const MAX_SEARCH_FACT_SAMPLES = 5;
const MAX_DESCRIPTION_FACT = 60;

type Scope = {
  /** Explicitly resolved scope, or null for state questions that need none. */
  dateRange: ResolvedDateRange | null;
  currency: string | null;
  accountId: string | null;
  ownedAccounts: Array<{ id: string; name: string }>;
  currencies: string[];
};

export type SearchResultItem = {
  id: string;
  bookingDate: string;
  amount: string;
  currency: string;
  direction: string;
  description: string;
  merchantName: string | null;
  categoryName: string | null;
  reviewed: boolean;
  accountName: string;
};

export type AdvisorAnswerPayload = {
  text: string;
  facts: AdvisorFact[];
  searchResults: SearchResultItem[];
  drilldowns: Drilldown[];
  scope: { dateRange: ResolvedDateRange | null; currency: string | null; accountId: string | null };
  toolNames: string[];
  providerId: string | null;
  model: string | null;
  /** Deterministic proposal draft (never auto-executed); the UI completes
   * it and the server validates, previews, and confirms the mutation. */
  proposal: BudgetProposalDraft | null;
};

export type AdvisorClarification = {
  status: 'needs_clarification';
  reason: 'date_range';
  message: string;
  options: ClarificationOption[];
};

export type AdvisorAnswer =
  | {
      status: 'answered';
      threadId: string;
      messageId: string;
      answer: AdvisorAnswerPayload;
    }
  | {
      status: 'unsupported';
      threadId: string;
      messageId: string;
      answer: AdvisorAnswerPayload;
    }
  | {
      status: 'needs_clarification';
      threadId: string;
      messageId: string;
      clarification: AdvisorClarification;
    };

export type BudgetProposalDraft = {
  type: 'create_budget';
  currency: string | null;
  categoryId: string | null;
  accountId: string | null;
  name: string;
};

function notFound(message: string): never {
  throw new AuthBoundaryError('NOT_FOUND', message);
}

async function listOwnedAccounts(db: RacioDatabase, userId: string) {
  const rows = await db
    .select({ id: schema.financialAccounts.id, displayName: schema.financialAccounts.displayName })
    .from(schema.financialAccounts)
    .where(eq(schema.financialAccounts.userId, userId))
    .orderBy(schema.financialAccounts.displayName);
  return rows.map((row) => ({ id: row.id, name: row.displayName }));
}

async function listCurrencies(db: RacioDatabase, userId: string): Promise<string[]> {
  const [accountRows, transactionRows] = await Promise.all([
    db
      .select({ currency: schema.financialAccounts.currencyCode })
      .from(schema.financialAccounts)
      .where(eq(schema.financialAccounts.userId, userId)),
    db
      .select({ currency: schema.transactions.currencyCode })
      .from(schema.transactions)
      .where(eq(schema.transactions.userId, userId))
      .groupBy(schema.transactions.currencyCode),
  ]);
  return [
    ...new Set([
      ...accountRows.map((row) => row.currency),
      ...transactionRows.map((row) => row.currency),
    ]),
  ].sort();
}

async function resolveScope(
  db: RacioDatabase,
  userId: string,
  context: AdvisorContext | undefined,
): Promise<Scope> {
  const ownedAccounts = await listOwnedAccounts(db, userId);
  const currencies = await listCurrencies(db, userId);
  let accountId: string | null = null;
  if (context?.accountId) {
    if (!ownedAccounts.some((account) => account.id === context.accountId))
      notFound('Financial account not found.');
    accountId = context.accountId;
  }
  return {
    dateRange: null,
    currency: context?.currency ?? null,
    accountId,
    ownedAccounts,
    currencies,
  };
}

function defaultToolLimits(maxTransactionSamples: number): ToolLimits {
  return {
    maxTransactionSamples,
    maxBreakdownItems: 8,
    maxBudgetRows: 8,
    maxGoalRows: 8,
    maxAlertItems: 20,
    maxReconciliationRows: 10,
  };
}

export async function answerAdvisorQuestion(input: {
  db: RacioDatabase;
  userId: string;
  preferences: UserPreferences;
  runtime: AiRuntime;
  query: AdvisorQuery;
  rateLimiter: RateLimiter;
  strings: AdvisorStrings;
}): Promise<AdvisorAnswer> {
  const { db, userId, preferences, runtime, query, rateLimiter, strings } = input;
  if (runtime.availability !== 'available' || !runtime.provider) throw new AiError('AI_DISABLED');
  if (query.message.length > runtime.config.maxInputChars) throw new AiError('AI_CONTEXT_LIMIT');
  rateLimiter.check(userId);

  const scopePrelim = await resolveScope(db, userId, query.context);
  const plan = planAdvisorRequest(
    query.message,
    query.context,
    preferences,
    scopePrelim.ownedAccounts,
    scopePrelim.currencies,
  );
  const dateRange = plan.dateRange;
  const scope: Scope = { ...scopePrelim, dateRange };

  const limits = defaultToolLimits(runtime.config.maxTransactionSamples);
  const toolContext: ToolContext = { db, userId, preferences, limits };

  if (plan.needsClarification) {
    // Temporally ambiguous question: no tools execute and no provider call
    // happens before the user picks a deterministic scope.
    const options = buildClarificationOptions(preferences.timeZone, strings.clarificationOptions);
    const threadId = await ensureThread(db, userId, query.threadId, query.message);
    await appendMessage(db, userId, threadId, 'user', query.message);
    const messageId = await appendMessage(
      db,
      userId,
      threadId,
      'assistant',
      strings.clarificationMessage,
    );
    return {
      status: 'needs_clarification',
      threadId,
      messageId,
      clarification: {
        status: 'needs_clarification',
        reason: 'date_range',
        message: strings.clarificationMessage,
        options,
      },
    };
  }

  if (plan.topic === 'unsupported') {
    const threadId = await ensureThread(db, userId, query.threadId, query.message);
    await appendMessage(db, userId, threadId, 'user', query.message);
    const assistantId = await appendMessage(db, userId, threadId, 'assistant', strings.unsupported);
    return {
      status: 'unsupported',
      threadId,
      messageId: assistantId,
      answer: {
        text: strings.unsupported,
        facts: [],
        searchResults: [],
        drilldowns: [],
        scope: { dateRange, currency: scope.currency, accountId: scope.accountId },
        toolNames: [],
        providerId: runtime.providerId,
        model: runtime.model,
        proposal: null,
      },
    };
  }

  if (topicRequiresDateRange(plan.topic) && !dateRange)
    throw new AuthBoundaryError('VALIDATION', 'A date range is required for this question.');

  if (!plan.toolNames.every(isToolName)) throw new AiError('AI_INVALID_TOOL_CALL');
  const toolNames = plan.toolNames.slice(0, runtime.config.maxToolCalls);

  const executions: Array<{ name: ToolName; output: unknown }> = [];
  for (const name of toolNames) {
    const args = buildToolArgs(name, scope, limits);
    const result = await executeTool(toolContext, name, args);
    executions.push({ name, output: result.output });
  }

  const { facts, searchResults } = buildFacts(executions, preferences.locale, scope);

  if (facts.length === 0) {
    // No data for the requested scope: answer deterministically without
    // calling the provider, so the model can never invent facts or numbers.
    const threadId = await ensureThread(db, userId, query.threadId, query.message);
    await appendMessage(db, userId, threadId, 'user', query.message);
    const messageId = await appendMessage(db, userId, threadId, 'assistant', strings.noData);
    return {
      status: 'answered',
      threadId,
      messageId,
      answer: {
        text: strings.noData,
        facts: [],
        searchResults,
        drilldowns: [],
        scope: { dateRange, currency: scope.currency, accountId: scope.accountId },
        toolNames,
        providerId: null,
        model: null,
        proposal: null,
      },
    };
  }

  const factsById = new Map(facts.map((fact) => [fact.id, fact]));
  const explanation = await generateExplanation(runtime, query.message, facts, factsById);
  const text = renderAnswer(explanation.text, factsById, preferences.locale);
  const citedFacts = facts
    .filter((fact) => explanation.citedFacts.includes(fact.id))
    .slice(0, MAX_FACTS);
  const seenHrefs = new Set<string>();
  const drilldowns: Drilldown[] = [];
  for (const fact of citedFacts) {
    if (fact.drilldown && !seenHrefs.has(fact.drilldown.href)) {
      seenHrefs.add(fact.drilldown.href);
      drilldowns.push(fact.drilldown);
    }
  }

  const proposal =
    plan.proposalIntent === 'create_budget'
      ? await buildBudgetProposalDraft(db, userId, query.message, scope, preferences)
      : null;

  const threadId = await ensureThread(db, userId, query.threadId, query.message);
  await appendMessage(db, userId, threadId, 'user', query.message);
  const messageId = await appendMessage(db, userId, threadId, 'assistant', text);

  return {
    status: 'answered',
    threadId,
    messageId,
    answer: {
      text,
      facts: citedFacts,
      searchResults,
      drilldowns,
      scope: { dateRange, currency: scope.currency, accountId: scope.accountId },
      toolNames,
      providerId: runtime.providerId,
      model: runtime.model,
      proposal,
    },
  };
}

async function buildBudgetProposalDraft(
  db: RacioDatabase,
  userId: string,
  message: string,
  scope: Scope,
  preferences: UserPreferences,
): Promise<BudgetProposalDraft> {
  const categories = await db
    .select({ id: schema.categories.id, name: schema.categories.name })
    .from(schema.categories)
    .where(and(eq(schema.categories.userId, userId), eq(schema.categories.status, 'active')));
  const lowered = message.toLocaleLowerCase('en-US');
  const matched = categories.find((category) =>
    lowered.includes(category.name.toLocaleLowerCase('en-US')),
  );
  const currency = scope.currency ?? preferences.baseCurrency ?? null;
  return {
    type: 'create_budget',
    currency,
    categoryId: matched?.id ?? null,
    accountId: scope.accountId,
    name: matched?.name ?? '',
  };
}

async function ensureThread(
  db: RacioDatabase,
  userId: string,
  threadId: string | undefined,
  firstQuestion: string,
) {
  if (threadId) return threadId;
  const title = firstQuestion.replace(/\s+/gu, ' ').trim().slice(0, 80);
  return createThread(db, userId, title);
}

function buildToolArgs(name: ToolName, scope: Scope, limits: ToolLimits): unknown {
  switch (name) {
    case 'get_period_summary':
    case 'get_category_breakdown':
    case 'get_merchant_breakdown': {
      const range = requireDateRange(scope);
      return {
        dateRange: { from: range.from, to: range.to },
        currency: scope.currency ?? undefined,
        accountId: scope.accountId ?? undefined,
      };
    }
    case 'get_account_overview':
      return {
        dateRange: scope.dateRange
          ? { from: scope.dateRange.from, to: scope.dateRange.to }
          : undefined,
        accountId: scope.accountId ?? undefined,
      };
    case 'get_budget_status':
      return {};
    case 'get_goal_progress':
      return {};
    case 'get_alert_summary':
      return { limit: limits.maxAlertItems };
    case 'get_uncategorized_allocations':
      return { currency: scope.currency ?? undefined };
    case 'get_reconciliation_status':
      return {};
    case 'search_transactions': {
      const range = requireDateRange(scope);
      return {
        dateRange: { from: range.from, to: range.to },
        currency: scope.currency ?? undefined,
        accountId: scope.accountId ?? undefined,
        limit: limits.maxTransactionSamples,
      };
    }
    case 'compare_periods': {
      const range = requireDateRange(scope);
      const previous = previousRangeOf(range);
      return {
        current: { from: range.from, to: range.to },
        previous: { from: previous.from, to: previous.to },
        currency: scope.currency ?? undefined,
        accountId: scope.accountId ?? undefined,
      };
    }
    default:
      return {};
  }
}

function requireDateRange(scope: Scope): ResolvedDateRange {
  if (!scope.dateRange)
    throw new AuthBoundaryError('VALIDATION', 'A date range is required for this question.');
  return scope.dateRange;
}

type Execution = { name: ToolName; output: unknown };

function buildFacts(
  executions: Execution[],
  locale: string,
  scope: Scope,
): { facts: AdvisorFact[]; searchResults: SearchResultItem[] } {
  const facts: AdvisorFact[] = [];
  let searchResults: SearchResultItem[] = [];
  let counter = 0;
  const range = scope.dateRange;
  const rangeParams = range ? { from: range.from, to: range.to } : undefined;
  const next = (
    tool: string,
    label: string,
    value: AdvisorFact['value'],
    drilldown?: Drilldown,
  ) => {
    counter += 1;
    facts.push({ id: `fact-${counter}`, tool, label, value, drilldown });
  };

  for (const execution of executions) {
    const output = execution.output as Record<string, unknown>;
    switch (execution.name) {
      case 'get_period_summary': {
        const values = (output.values ?? []) as Array<{
          currency: string;
          income: string;
          expense: string;
          net: string;
          count: number;
        }>;
        for (const row of values) {
          const drill = transactionsDrilldown(locale, {
            dateRange: rangeParams,
            currency: row.currency,
          });
          next(
            execution.name,
            `Total income (${row.currency})`,
            {
              kind: 'money',
              amount: row.income,
              currency: row.currency,
            },
            drill,
          );
          next(
            execution.name,
            `Total expenses (${row.currency})`,
            {
              kind: 'money',
              amount: row.expense,
              currency: row.currency,
            },
            drill,
          );
          next(
            execution.name,
            `Net cash flow (${row.currency})`,
            {
              kind: 'money',
              amount: row.net,
              currency: row.currency,
            },
            drill,
          );
          next(execution.name, `Transactions in range (${row.currency})`, {
            kind: 'number',
            value: row.count,
          });
        }
        break;
      }
      case 'get_category_breakdown': {
        const values = (output.values ?? []) as Array<{
          currency: string;
          items: Array<{
            categoryId: string | null;
            name: string | null;
            amount: string;
          }>;
        }>;
        for (const group of values) {
          for (const item of group.items) {
            const name = item.name ?? 'Uncategorized';
            next(
              execution.name,
              `Spending in ${name} (${group.currency})`,
              {
                kind: 'money',
                amount: item.amount,
                currency: group.currency,
              },
              transactionsDrilldown(locale, {
                dateRange: rangeParams,
                currency: group.currency,
                categoryId: item.categoryId ?? undefined,
              }),
            );
          }
        }
        break;
      }
      case 'get_merchant_breakdown': {
        const values = (output.values ?? []) as Array<{
          currency: string;
          items: Array<{ name: string; amount: string }>;
        }>;
        for (const group of values) {
          for (const item of group.items) {
            next(
              execution.name,
              `Spending at ${item.name} (${group.currency})`,
              {
                kind: 'money',
                amount: item.amount,
                currency: group.currency,
              },
              transactionsDrilldown(locale, {
                dateRange: rangeParams,
                currency: group.currency,
              }),
            );
          }
        }
        break;
      }
      case 'get_account_overview': {
        const accounts = (output.accounts ?? []) as Array<{
          id: string;
          name: string;
          currency: string;
          balance: string | null;
          balanceAsOf: string | null;
          balanceSource: string | null;
          netActivity: string;
          transactionCount: number;
        }>;
        for (const account of accounts) {
          if (account.balance !== null) {
            next(execution.name, `Balance of ${account.name}`, {
              kind: 'money',
              amount: account.balance,
              currency: account.currency,
            });
          } else {
            next(execution.name, `Balance of ${account.name}`, {
              kind: 'text',
              value: 'Balance unavailable',
            });
          }
        }
        break;
      }
      case 'get_budget_status': {
        const budgets = (output.budgets ?? []) as Array<{
          id: string;
          name: string;
          currency: string;
          limit: string;
          spent: string;
          remaining: string;
          percentageUsed: string;
          status: string;
          previousSpent: string | null;
        }>;
        for (const budget of budgets) {
          next(
            execution.name,
            `Budget "${budget.name}" limit`,
            {
              kind: 'money',
              amount: budget.limit,
              currency: budget.currency,
            },
            budgetsDrilldown(locale),
          );
          next(
            execution.name,
            `Budget "${budget.name}" spent`,
            {
              kind: 'money',
              amount: budget.spent,
              currency: budget.currency,
            },
            budgetsDrilldown(locale),
          );
          next(
            execution.name,
            `Budget "${budget.name}" remaining`,
            {
              kind: 'money',
              amount: budget.remaining,
              currency: budget.currency,
            },
            budgetsDrilldown(locale),
          );
          next(
            execution.name,
            `Budget "${budget.name}" used`,
            {
              kind: 'number',
              value: Number(budget.percentageUsed),
            },
            budgetsDrilldown(locale),
          );
        }
        break;
      }
      case 'get_goal_progress': {
        const goals = (output.goals ?? []) as Array<{
          id: string;
          name: string;
          currency: string;
          targetAmount: string;
          currentAmount: string | null;
          remaining: string | null;
          percentageComplete: string | null;
          balanceAvailable: boolean;
        }>;
        for (const goal of goals) {
          next(
            execution.name,
            `Goal "${goal.name}" target`,
            {
              kind: 'money',
              amount: goal.targetAmount,
              currency: goal.currency,
            },
            goalsDrilldown(locale),
          );
          if (goal.balanceAvailable && goal.currentAmount !== null) {
            next(
              execution.name,
              `Goal "${goal.name}" saved`,
              {
                kind: 'money',
                amount: goal.currentAmount,
                currency: goal.currency,
              },
              goalsDrilldown(locale),
            );
            if (goal.remaining !== null)
              next(
                execution.name,
                `Goal "${goal.name}" remaining`,
                {
                  kind: 'money',
                  amount: goal.remaining,
                  currency: goal.currency,
                },
                goalsDrilldown(locale),
              );
          } else {
            next(
              execution.name,
              `Goal "${goal.name}" progress`,
              {
                kind: 'text',
                value: 'Progress unavailable',
              },
              goalsDrilldown(locale),
            );
          }
          if (goal.percentageComplete !== null)
            next(
              execution.name,
              `Goal "${goal.name}" complete`,
              {
                kind: 'number',
                value: Number(goal.percentageComplete),
              },
              goalsDrilldown(locale),
            );
        }
        break;
      }
      case 'get_alert_summary': {
        const unread = (output.unread ?? 0) as number;
        next(
          execution.name,
          'Unread alerts',
          { kind: 'number', value: unread },
          alertsDrilldown(locale),
        );
        break;
      }
      case 'get_uncategorized_allocations': {
        const values = (output.values ?? []) as Array<{
          currency: string;
          amount: string;
          count: number;
        }>;
        for (const row of values) {
          next(
            execution.name,
            `Uncategorized spending (${row.currency})`,
            {
              kind: 'money',
              amount: row.amount,
              currency: row.currency,
            },
            transactionsDrilldown(locale, {
              dateRange: rangeParams,
              currency: row.currency,
              search: '',
            }),
          );
          next(execution.name, `Uncategorized transactions (${row.currency})`, {
            kind: 'number',
            value: row.count,
          });
        }
        break;
      }
      case 'get_reconciliation_status': {
        const statements = (output.statements ?? []) as Array<{
          id: string;
          periodStart: string | null;
          periodEnd: string | null;
          currency: string | null;
          difference: string | null;
          status: string;
        }>;
        for (const statement of statements) {
          if (statement.status === 'mismatch') {
            next(
              execution.name,
              `Reconciliation difference (${statement.currency ?? '?'})`,
              {
                kind: 'money',
                amount: statement.difference ?? '0',
                currency: statement.currency ?? '???',
              },
              reconciliationDrilldown(locale),
            );
          } else {
            next(
              execution.name,
              'Reconciliation status',
              {
                kind: 'text',
                value: statement.status,
              },
              importsDrilldown(locale),
            );
          }
        }
        break;
      }
      case 'search_transactions': {
        const total = (output.total ?? 0) as number;
        const items = (output.items ?? []) as SearchResultItem[];
        next(
          execution.name,
          'Matching transactions',
          { kind: 'number', value: total },
          transactionsDrilldown(locale, {
            dateRange: rangeParams,
            currency: scope.currency ?? undefined,
          }),
        );
        for (const item of items.slice(0, MAX_SEARCH_FACT_SAMPLES)) {
          const description = item.description.replace(/\s+/gu, ' ').slice(0, MAX_DESCRIPTION_FACT);
          next(
            execution.name,
            `Transaction ${item.bookingDate} ${description}`,
            { kind: 'money', amount: item.amount, currency: item.currency },
            transactionsDrilldown(locale, { search: description }),
          );
        }
        searchResults = items;
        break;
      }
      case 'compare_periods': {
        const deltas = (output.deltas ?? []) as Array<{
          currency: string;
          expenseChange: string;
          expensePercentage: string | null;
          expenseStatus: string;
          incomeChange: string;
          incomePercentage: string | null;
          incomeStatus: string;
        }>;
        for (const delta of deltas) {
          next(execution.name, `Expense change (${delta.currency})`, {
            kind: 'money',
            amount: delta.expenseChange,
            currency: delta.currency,
          });
          if (delta.expensePercentage !== null)
            next(execution.name, `Expense change percentage (${delta.currency})`, {
              kind: 'number',
              value: Number(delta.expensePercentage),
            });
          next(execution.name, `Income change (${delta.currency})`, {
            kind: 'money',
            amount: delta.incomeChange,
            currency: delta.currency,
          });
        }
        break;
      }
      default:
        break;
    }
    if (facts.length >= MAX_FACTS) break;
  }

  return { facts: facts.slice(0, MAX_FACTS), searchResults };
}

export type AdvisorStatus = {
  enabled: boolean;
  providerId: string | null;
  model: string | null;
  remote: boolean;
  privacyDisclosed: boolean;
};

export function getAdvisorStatus(runtime: AiRuntime): AdvisorStatus {
  return {
    enabled: runtime.availability === 'available',
    providerId: runtime.availability === 'available' ? runtime.providerId : null,
    model: runtime.availability === 'available' ? runtime.model : null,
    remote: runtime.remote,
    privacyDisclosed: false,
  };
}
