import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { AuthBoundaryError, ensureUserPreferences, requireUser } from '@racio/auth';
import { AccountShell } from '../../../components/account-shell';
import { GoalsWorkspace } from '../../../components/goals-workspace';
import { ThemeSync } from '../../../components/theme-sync';
import { database } from '../../../lib/database';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function GoalsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  let user;
  try {
    user = await requireUser(await headers());
  } catch (error) {
    if (!(error instanceof AuthBoundaryError)) throw error;
    redirect(`/${locale}/sign-in?returnTo=/${locale}/goals`);
  }
  const preferences = await ensureUserPreferences(database.db, user.id);
  const t = await getTranslations('goals');
  const labels = Object.fromEntries(
    [
      'name',
      'currency',
      'targetAmount',
      'targetDate',
      'trackingMode',
      'manual',
      'accountBalance',
      'account',
      'manualSavedAmount',
      'create',
      'save',
      'edit',
      'cancel',
      'updateProgress',
      'archive',
      'restore',
      'showArchived',
      'hideArchived',
      'target',
      'saved',
      'remaining',
      'complete',
      'daysRemaining',
      'balanceUnavailable',
      'balanceAsOf',
      'empty',
      'exceeded',
      'error',
    ].map((key) => [key, t(key)]),
  ) as Record<string, string>;
  return (
    <AccountShell locale={locale} name={user.name}>
      <ThemeSync appearance={preferences.appearance} />
      <section className="management-page" aria-labelledby="goals-title">
        <div className="page-heading">
          <p className="eyebrow">{t('eyebrow')}</p>
          <h1 id="goals-title">{t('title')}</h1>
          <p>{t('description')}</p>
        </div>
        <GoalsWorkspace advanced={preferences.interfaceMode === 'advanced'} labels={labels} />
      </section>
    </AccountShell>
  );
}
