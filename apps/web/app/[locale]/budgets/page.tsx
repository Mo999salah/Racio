import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { AuthBoundaryError, ensureUserPreferences, requireUser } from '@racio/auth';
import { AccountShell } from '../../../components/account-shell';
import { BudgetsWorkspace } from '../../../components/budgets-workspace';
import { ThemeSync } from '../../../components/theme-sync';
import { database } from '../../../lib/database';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function BudgetsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  let user;
  try {
    user = await requireUser(await headers());
  } catch (error) {
    if (!(error instanceof AuthBoundaryError)) throw error;
    redirect(`/${locale}/sign-in?returnTo=/${locale}/budgets`);
  }
  const preferences = await ensureUserPreferences(database.db, user.id);
  const t = await getTranslations('budgets');
  const labels = Object.fromEntries(
    [
      'name',
      'currency',
      'amount',
      'period',
      'weekly',
      'monthly',
      'yearly',
      'custom',
      'startDate',
      'endDate',
      'category',
      'allCategories',
      'account',
      'allAccounts',
      'warningThreshold',
      'rollover',
      'create',
      'save',
      'edit',
      'cancel',
      'archive',
      'restore',
      'showArchived',
      'hideArchived',
      'disable',
      'enable',
      'spent',
      'limit',
      'remaining',
      'used',
      'daysRemaining',
      'previousSpent',
      'status',
      'healthy',
      'approaching',
      'exceeded',
      'complete',
      'periodRange',
      'rolloverCarried',
      'empty',
      'error',
      'exceeded',
    ].map((key) => [key, t(key)]),
  ) as Record<string, string>;
  return (
    <AccountShell locale={locale} name={user.name}>
      <ThemeSync appearance={preferences.appearance} />
      <section className="management-page" aria-labelledby="budgets-title">
        <div className="page-heading">
          <p className="eyebrow">{t('eyebrow')}</p>
          <h1 id="budgets-title">{t('title')}</h1>
          <p>{t('description')}</p>
        </div>
        <BudgetsWorkspace advanced={preferences.interfaceMode === 'advanced'} labels={labels} />
      </section>
    </AccountShell>
  );
}
