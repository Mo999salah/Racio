import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { AuthBoundaryError, ensureUserPreferences, requireUser } from '@racio/auth';
import { getDashboardSummary } from '@racio/transactions';
import { getPlanningSummary } from '@racio/planning';
import { AccountShell } from '../../components/account-shell';
import { DashboardWorkspace } from '../../components/dashboard-workspace';
import { ThemeSync } from '../../components/theme-sync';
import { database } from '../../lib/database';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type PeriodKey = 'last30' | 'thisMonth' | 'lastMonth' | 'last90';

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function firstOfMonth(offset: number) {
  const now = new Date();
  return isoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)));
}

function lastOfMonth(offset: number) {
  const now = new Date();
  return isoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 0)));
}

function daysAgo(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return isoDate(date);
}

function resolvePeriod(period: string | undefined): {
  key: PeriodKey;
  dateFrom?: string;
  dateTo?: string;
} {
  const today = isoDate(new Date());
  switch (period) {
    case 'thisMonth':
      return { key: 'thisMonth', dateFrom: firstOfMonth(0), dateTo: today };
    case 'lastMonth':
      return { key: 'lastMonth', dateFrom: firstOfMonth(-1), dateTo: lastOfMonth(-1) };
    case 'last90':
      return { key: 'last90', dateFrom: daysAgo(89), dateTo: today };
    default:
      return { key: 'last30' };
  }
}

export default async function HomePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const { locale } = await params;
  const { period } = await searchParams;
  const requestHeaders = await headers();
  let user;
  try {
    user = await requireUser(requestHeaders);
  } catch (error) {
    if (!(error instanceof AuthBoundaryError)) throw error;
    redirect(`/${locale}/sign-in?returnTo=/${locale}`);
  }
  const preferences = await ensureUserPreferences(database.db, user.id);
  const resolved = resolvePeriod(period);
  const [summary, planning] = await Promise.all([
    getDashboardSummary(database.db, user.id, {
      dateFrom: resolved.dateFrom,
      dateTo: resolved.dateTo,
    }),
    getPlanningSummary(database.db, user.id, preferences.timeZone),
  ]);
  const t = await getTranslations('dashboard');
  const labels = Object.fromEntries(
    [
      'eyebrow',
      'title',
      'description',
      'period',
      'inflow',
      'outflow',
      'net',
      'unresolved',
      'accountsHeading',
      'accountsEmptyTitle',
      'accountsEmptyBody',
      'addAccount',
      'accountNoData',
      'balance',
      'balanceAsOf',
      'whereMoneyWent',
      'categoriesHeading',
      'merchantsHeading',
      'noCategories',
      'noMerchants',
      'uncategorized',
      'attention',
      'attentionEmpty',
      'unreviewedTitle',
      'unreviewedBody',
      'statementsNeedingActionTitle',
      'reconciliationMismatchTitle',
      'noTransactionsTitle',
      'noTransactionsBody',
      'importStatement',
      'transactionsCount',
      'planning',
      'budgetNeedsAttention',
      'goalNeedsAttention',
      'unreadAlerts',
      'openBudgets',
      'openGoals',
      'openAlerts',
      'noPlanningAttention',
      'approaching',
      'exceeded',
    ].map((key) => [key, t(key)]),
  ) as Record<string, string>;

  return (
    <AccountShell locale={locale} name={user.name}>
      <ThemeSync appearance={preferences.appearance} />
      <DashboardWorkspace
        locale={locale}
        advanced={preferences.interfaceMode === 'advanced'}
        summary={summary}
        planning={planning}
        labels={labels}
        periodOptions={[
          { value: 'last30', label: t('periodLast30') },
          { value: 'thisMonth', label: t('periodThisMonth') },
          { value: 'lastMonth', label: t('periodLastMonth') },
          { value: 'last90', label: t('periodLast90') },
        ]}
        currentPeriod={resolved.key}
      />
    </AccountShell>
  );
}
