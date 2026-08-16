import type { RacioDatabase } from '@racio/database';
import { percentReached } from './money';
import { listBudgetsWithStatus } from './budgets';
import { listGoalsWithProgress } from './goals';
import { unreadAlertCount } from './alerts';

export type PlanningSummary = {
  budgets: Array<{
    id: string;
    name: string;
    currency: string;
    spent: string;
    limit: string;
    status: string;
  }>;
  goalsNeedingAttention: number;
  unreadAlerts: number;
};

/**
 * Minimal planning overview for the dashboard. Returns only budget rows that
 * need attention (approaching or exceeded) plus counts; the dedicated budgets,
 * goals, and alerts surfaces remain the primary views.
 */
export async function getPlanningSummary(
  db: RacioDatabase,
  userId: string,
  timeZone: string,
): Promise<PlanningSummary> {
  const [budgetStatuses, goals, unread] = await Promise.all([
    listBudgetsWithStatus(db, userId, timeZone, false),
    listGoalsWithProgress(db, userId, timeZone, false),
    unreadAlertCount(db, userId),
  ]);

  const budgets = budgetStatuses
    .filter((status) => status.status === 'approaching' || status.status === 'exceeded')
    .map((status) => ({
      id: status.budget.id,
      name: status.budget.name,
      currency: status.budget.currency,
      spent: status.spent,
      limit: status.limit,
      status: status.status,
    }));

  const goalsNeedingAttention = goals.filter((goal) => {
    if (!goal.balanceAvailable) return true;
    if (
      goal.goal.targetDate &&
      goal.daysRemaining !== null &&
      goal.daysRemaining <= 30 &&
      goal.currentAmount !== null &&
      !percentReached(goal.currentAmount, goal.goal.targetAmount, 100)
    )
      return true;
    return false;
  }).length;

  return { budgets, goalsNeedingAttention, unreadAlerts: unread };
}
