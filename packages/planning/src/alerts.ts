import { randomUUID } from 'node:crypto';
import { and, asc, count, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import type {
  AlertListQuery,
  AlertRuleConfig,
  AlertRuleCreate,
  AlertRulePatch,
} from '@racio/contracts';
import { alertRuleConfigSchema } from '@racio/contracts';
import { schema, type RacioDatabase } from '@racio/database';
import { AuthBoundaryError, getUserPreferences } from '@racio/auth';
import { getUncategorizedExpenseAllocations } from '@racio/transactions';
import { percentReached } from './money';
import { getBudgetStatus } from './budgets';
import { assertOwnedGoalIds, getGoalProgress } from './goals';

function notFound(message: string): never {
  throw new AuthBoundaryError('NOT_FOUND', message);
}

function validation(message: string): never {
  throw new AuthBoundaryError('VALIDATION', message);
}

type AlertRuleRow = typeof schema.alertRules.$inferSelect;
type AlertEventRow = typeof schema.alertEvents.$inferSelect;

function publicRule(row: AlertRuleRow | undefined) {
  if (!row) throw new Error('Alert rule insert did not return a row.');
  return {
    id: row.id,
    type: row.type,
    enabled: row.enabled,
    config: row.config,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function publicEvent(row: AlertEventRow | undefined) {
  if (!row) throw new Error('Alert event insert did not return a row.');
  return {
    id: row.id,
    ruleId: row.ruleId,
    type: row.type,
    entityType: row.entityType,
    entityId: row.entityId,
    metadata: row.metadata,
    triggeredAt: row.triggeredAt,
    readAt: row.readAt,
    dismissedAt: row.dismissedAt,
  };
}

async function ownedRule(db: RacioDatabase, userId: string, id: string): Promise<AlertRuleRow> {
  const [row] = await db
    .select()
    .from(schema.alertRules)
    .where(and(eq(schema.alertRules.id, id), eq(schema.alertRules.userId, userId)))
    .limit(1);
  if (!row) notFound('Alert rule not found.');
  return row;
}

async function validateRuleConfig(
  db: RacioDatabase,
  userId: string,
  config: unknown,
): Promise<AlertRuleConfig> {
  const parsed = alertRuleConfigSchema.safeParse(config);
  if (!parsed.success) validation('Invalid alert rule configuration.');
  if (parsed.data.type === 'goal_milestone' || parsed.data.type === 'goal_deadline')
    await assertOwnedGoalIds(db, userId, [parsed.data.goalId]);
  return parsed.data;
}

export async function createAlertRule(db: RacioDatabase, userId: string, input: AlertRuleCreate) {
  const config = await validateRuleConfig(db, userId, input.config);
  const [row] = await db
    .insert(schema.alertRules)
    .values({
      id: randomUUID(),
      userId,
      type: input.type,
      enabled: input.enabled,
      config,
      archivedAt: null,
    })
    .returning();
  return publicRule(row);
}

export async function updateAlertRule(
  db: RacioDatabase,
  userId: string,
  id: string,
  input: AlertRulePatch,
) {
  const current = await ownedRule(db, userId, id);
  let config = current.config as AlertRuleConfig;
  if (input.config !== undefined) config = await validateRuleConfig(db, userId, input.config);
  const [row] = await db
    .update(schema.alertRules)
    .set({
      ...(input.config === undefined ? {} : { config }),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      updatedAt: new Date(),
    })
    .where(and(eq(schema.alertRules.id, id), eq(schema.alertRules.userId, userId)))
    .returning();
  if (!row) notFound('Alert rule not found.');
  return publicRule(row);
}

export async function actionAlertRule(
  db: RacioDatabase,
  userId: string,
  id: string,
  action: 'enable' | 'disable' | 'archive' | 'restore',
) {
  await ownedRule(db, userId, id);
  const [row] = await db
    .update(schema.alertRules)
    .set({
      ...(action === 'enable' ? { enabled: true, archivedAt: null } : {}),
      ...(action === 'disable' ? { enabled: false } : {}),
      ...(action === 'archive' ? { enabled: false, archivedAt: new Date() } : {}),
      ...(action === 'restore' ? { enabled: false, archivedAt: null } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(schema.alertRules.id, id), eq(schema.alertRules.userId, userId)))
    .returning();
  if (!row) notFound('Alert rule not found.');
  return publicRule(row);
}

export async function listAlertRules(db: RacioDatabase, userId: string, includeArchived: boolean) {
  const rows = await db
    .select()
    .from(schema.alertRules)
    .where(
      and(
        eq(schema.alertRules.userId, userId),
        includeArchived ? undefined : isNull(schema.alertRules.archivedAt),
      ),
    )
    .orderBy(asc(schema.alertRules.createdAt), asc(schema.alertRules.id));
  return rows.map(publicRule);
}

async function ownedEvent(db: RacioDatabase, userId: string, id: string): Promise<AlertEventRow> {
  const [row] = await db
    .select()
    .from(schema.alertEvents)
    .where(and(eq(schema.alertEvents.id, id), eq(schema.alertEvents.userId, userId)))
    .limit(1);
  if (!row) notFound('Alert not found.');
  return row;
}

export async function actionAlertEvent(
  db: RacioDatabase,
  userId: string,
  id: string,
  action: 'read' | 'unread' | 'dismiss',
) {
  await ownedEvent(db, userId, id);
  const [row] = await db
    .update(schema.alertEvents)
    .set({
      ...(action === 'read' ? { readAt: new Date() } : {}),
      ...(action === 'unread' ? { readAt: null } : {}),
      ...(action === 'dismiss' ? { dismissedAt: new Date(), readAt: new Date() } : {}),
    })
    .where(and(eq(schema.alertEvents.id, id), eq(schema.alertEvents.userId, userId)))
    .returning();
  if (!row) notFound('Alert not found.');
  return publicEvent(row);
}

export async function listAlertEvents(db: RacioDatabase, userId: string, input: AlertListQuery) {
  const conditions = [eq(schema.alertEvents.userId, userId)];
  if (input.state === 'unread')
    conditions.push(isNull(schema.alertEvents.readAt), isNull(schema.alertEvents.dismissedAt));
  else if (input.state === 'read')
    conditions.push(isNotNull(schema.alertEvents.readAt), isNull(schema.alertEvents.dismissedAt));
  else if (input.state === 'dismissed') conditions.push(isNotNull(schema.alertEvents.dismissedAt));

  const [countRows, rows] = await Promise.all([
    db
      .select({ total: count() })
      .from(schema.alertEvents)
      .where(and(...conditions)),
    db
      .select()
      .from(schema.alertEvents)
      .where(and(...conditions))
      .orderBy(desc(schema.alertEvents.triggeredAt), desc(schema.alertEvents.id))
      .limit(input.limit)
      .offset(input.offset),
  ]);

  return {
    items: rows.map(publicEvent),
    page: {
      limit: input.limit,
      offset: input.offset,
      total: Number(countRows[0]?.total ?? 0),
      hasMore: input.offset + rows.length < Number(countRows[0]?.total ?? 0),
    },
  };
}

export async function unreadAlertCount(db: RacioDatabase, userId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(schema.alertEvents)
    .where(
      and(
        eq(schema.alertEvents.userId, userId),
        isNull(schema.alertEvents.readAt),
        isNull(schema.alertEvents.dismissedAt),
      ),
    );
  return Number(row?.total ?? 0);
}

async function insertEvent(
  db: RacioDatabase,
  userId: string,
  event: {
    ruleId?: string | null;
    type: (typeof schema.alertEvents.$inferInsert)['type'];
    entityType: string;
    entityId: string;
    dedupeKey: string;
    metadata: Record<string, unknown>;
  },
) {
  return db
    .insert(schema.alertEvents)
    .values({
      id: randomUUID(),
      userId,
      ruleId: event.ruleId ?? null,
      type: event.type,
      entityType: event.entityType,
      entityId: event.entityId,
      dedupeKey: event.dedupeKey,
      metadata: event.metadata,
    })
    .onConflictDoNothing({ target: [schema.alertEvents.userId, schema.alertEvents.dedupeKey] })
    .returning({ id: schema.alertEvents.id });
}

export type AlertEvaluationResult = {
  budgets: number;
  rules: number;
  statements: number;
  eventsCreated: number;
};

export async function evaluateUserAlerts(
  db: RacioDatabase,
  userId: string,
  timeZone: string,
): Promise<AlertEvaluationResult> {
  let eventsCreated = 0;
  let budgets = 0;
  let rules = 0;
  let statements = 0;

  // Budget approaching/exceeded (derived deterministically from budget state).
  const budgetRows = await db
    .select()
    .from(schema.budgets)
    .where(
      and(
        eq(schema.budgets.userId, userId),
        eq(schema.budgets.enabled, true),
        isNull(schema.budgets.archivedAt),
      ),
    );
  for (const budget of budgetRows) {
    budgets += 1;
    const status = await getBudgetStatus(db, userId, budget.id, timeZone);
    if (status.status === 'exceeded') {
      const created = await insertEvent(db, userId, {
        type: 'budget_exceeded',
        entityType: 'budget',
        entityId: budget.id,
        dedupeKey: `budget:${budget.id}:${status.periodKey}:exceeded`,
        metadata: {},
      });
      eventsCreated += created.length;
    } else if (status.status === 'approaching') {
      const threshold = budget.warningThreshold ?? 80;
      const created = await insertEvent(db, userId, {
        type: 'budget_approaching',
        entityType: 'budget',
        entityId: budget.id,
        dedupeKey: `budget:${budget.id}:${status.periodKey}:approaching:${threshold}`,
        metadata: { threshold },
      });
      eventsCreated += created.length;
    }
  }

  // Reconciliation mismatch (derived from confirmed statements).
  const mismatchStatements = await db
    .select({ id: schema.statements.id })
    .from(schema.statements)
    .where(
      and(
        eq(schema.statements.userId, userId),
        eq(schema.statements.processingStatus, 'imported'),
        eq(schema.statements.reconciliationStatus, 'mismatch'),
      ),
    );
  for (const statement of mismatchStatements) {
    statements += 1;
    const created = await insertEvent(db, userId, {
      type: 'reconciliation_mismatch',
      entityType: 'statement',
      entityId: statement.id,
      dedupeKey: `reconciliation:${statement.id}`,
      metadata: {},
    });
    eventsCreated += created.length;
  }

  // User-configured alert rules.
  const ruleRows = await db
    .select()
    .from(schema.alertRules)
    .where(
      and(
        eq(schema.alertRules.userId, userId),
        eq(schema.alertRules.enabled, true),
        isNull(schema.alertRules.archivedAt),
      ),
    );

  for (const rule of ruleRows) {
    rules += 1;
    const config = rule.config as {
      type: string;
      threshold?: number;
      goalId?: string;
      milestones?: number[];
      daysBefore?: number;
    };

    if (config.type === 'uncategorized_transactions' && typeof config.threshold === 'number') {
      const allocations = await getUncategorizedExpenseAllocations(db, userId);
      const totalCount = allocations.reduce((sum, allocation) => sum + allocation.count, 0);
      if (totalCount > config.threshold) {
        const created = await insertEvent(db, userId, {
          ruleId: rule.id,
          type: 'uncategorized_transactions',
          entityType: 'transactions',
          entityId: 'ledger',
          dedupeKey: `uncategorized:threshold:${config.threshold}`,
          metadata: {
            threshold: config.threshold,
            count: totalCount,
            amountsByCurrency: allocations.map((allocation) => ({
              currency: allocation.currency,
              amount: allocation.amount,
            })),
          },
        });
        eventsCreated += created.length;
      }
    } else if (config.type === 'goal_milestone' && config.goalId && config.milestones) {
      const progress = await getGoalProgress(db, userId, config.goalId, timeZone);
      if (progress.currentAmount !== null) {
        for (const milestone of config.milestones) {
          if (percentReached(progress.currentAmount, progress.goal.targetAmount, milestone)) {
            const created = await insertEvent(db, userId, {
              ruleId: rule.id,
              type: 'goal_milestone',
              entityType: 'goal',
              entityId: config.goalId,
              dedupeKey: `goal:${config.goalId}:milestone:${milestone}`,
              metadata: { milestone },
            });
            eventsCreated += created.length;
          }
        }
      }
    } else if (
      config.type === 'goal_deadline' &&
      config.goalId &&
      typeof config.daysBefore === 'number'
    ) {
      const progress = await getGoalProgress(db, userId, config.goalId, timeZone);
      const days = progress.daysRemaining;
      if (days !== null && days <= config.daysBefore) {
        const created = await insertEvent(db, userId, {
          ruleId: rule.id,
          type: 'goal_deadline',
          entityType: 'goal',
          entityId: config.goalId,
          dedupeKey: `goal:${config.goalId}:deadline:${config.daysBefore}`,
          metadata: { daysBefore: config.daysBefore },
        });
        eventsCreated += created.length;
      }
    }
  }

  return { budgets, rules, statements, eventsCreated };
}

export async function evaluateAlertsForUser(db: RacioDatabase, userId: string) {
  const preferences = await getUserPreferences(db, userId);
  return evaluateUserAlerts(db, userId, preferences.timeZone);
}

/**
 * Distinct users that may have actionable alert conditions, bounded to `limit`.
 * Used by the periodic sweep worker to fan out per-user evaluation jobs.
 */
export async function listEvaluationUserIds(db: RacioDatabase, limit = 500): Promise<string[]> {
  const [budgetUsers, goalUsers, ruleUsers, mismatchUsers] = await Promise.all([
    db
      .select({ userId: schema.budgets.userId })
      .from(schema.budgets)
      .where(and(eq(schema.budgets.enabled, true), isNull(schema.budgets.archivedAt)))
      .groupBy(schema.budgets.userId),
    db
      .select({ userId: schema.savingsGoals.userId })
      .from(schema.savingsGoals)
      .where(and(eq(schema.savingsGoals.enabled, true), isNull(schema.savingsGoals.archivedAt)))
      .groupBy(schema.savingsGoals.userId),
    db
      .select({ userId: schema.alertRules.userId })
      .from(schema.alertRules)
      .where(and(eq(schema.alertRules.enabled, true), isNull(schema.alertRules.archivedAt)))
      .groupBy(schema.alertRules.userId),
    db
      .select({ userId: schema.statements.userId })
      .from(schema.statements)
      .where(
        and(
          eq(schema.statements.processingStatus, 'imported'),
          eq(schema.statements.reconciliationStatus, 'mismatch'),
        ),
      )
      .groupBy(schema.statements.userId),
  ]);
  const ids = new Set(
    [...budgetUsers, ...goalUsers, ...ruleUsers, ...mismatchUsers].map((row) => row.userId),
  );
  return [...ids].slice(0, limit);
}
