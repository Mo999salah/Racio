import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { AuthBoundaryError, ensureUserPreferences, requireUser } from '@racio/auth';
import { AccountShell } from '../../../components/account-shell';
import { AlertsWorkspace } from '../../../components/alerts-workspace';
import { ThemeSync } from '../../../components/theme-sync';
import { database } from '../../../lib/database';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AlertsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  let user;
  try {
    user = await requireUser(await headers());
  } catch (error) {
    if (!(error instanceof AuthBoundaryError)) throw error;
    redirect(`/${locale}/sign-in?returnTo=/${locale}/alerts`);
  }
  const preferences = await ensureUserPreferences(database.db, user.id);
  const t = await getTranslations('alerts');
  const labels = Object.fromEntries(
    [
      'unread',
      'read',
      'dismiss',
      'dismissed',
      'all',
      'markRead',
      'noAlerts',
      'budgetApproaching',
      'budgetExceeded',
      'reconciliationMismatch',
      'uncategorized',
      'goalMilestone',
      'goalDeadline',
      'viewBudget',
      'viewGoal',
      'viewTransactions',
      'viewImport',
      'rulesTitle',
      'rulesDescription',
      'ruleUncategorized',
      'ruleMilestone',
      'ruleDeadline',
      'threshold',
      'goal',
      'milestones',
      'daysBefore',
      'createRule',
      'ruleType',
      'enable',
      'disable',
      'archiveRule',
      'restoreRule',
      'noRules',
      'error',
      'count',
    ].map((key) => [key, t(key)]),
  ) as Record<string, string>;
  return (
    <AccountShell locale={locale} name={user.name}>
      <ThemeSync appearance={preferences.appearance} />
      <section className="management-page" aria-labelledby="alerts-title">
        <div className="page-heading">
          <p className="eyebrow">{t('eyebrow')}</p>
          <h1 id="alerts-title">{t('title')}</h1>
          <p>{t('description')}</p>
        </div>
        <AlertsWorkspace
          locale={locale}
          advanced={preferences.interfaceMode === 'advanced'}
          labels={labels}
        />
      </section>
    </AccountShell>
  );
}
