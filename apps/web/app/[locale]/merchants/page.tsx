import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { AuthBoundaryError, ensureUserPreferences, requireUser } from '@racio/auth';
import { AccountShell } from '../../../components/account-shell';
import { MerchantsWorkspace } from '../../../components/merchants-workspace';
import { ThemeSync } from '../../../components/theme-sync';
import { database } from '../../../lib/database';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function MerchantsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  let user;
  try {
    user = await requireUser(await headers());
  } catch (error) {
    if (!(error instanceof AuthBoundaryError)) throw error;
    redirect(`/${locale}/sign-in?returnTo=/${locale}/merchants`);
  }
  const preferences = await ensureUserPreferences(database.db, user.id);
  const t = await getTranslations('merchants');
  const labels = Object.fromEntries(
    [
      'name',
      'create',
      'preview',
      'apply',
      'matches',
      'saved',
      'error',
      'empty',
      'aliases',
      'close',
      'pattern',
      'matchType',
      'contains',
      'exact',
      'startsWith',
      'counterparty',
      'counterpartyContains',
      'addAlias',
      'disable',
      'enable',
      'mergeInto',
      'chooseMerchant',
      'merge',
      'unmerge',
      'active',
      'archived',
      'merged',
    ].map((key) => [key, t(key)]),
  );
  return (
    <AccountShell locale={locale} name={user.name}>
      <ThemeSync appearance={preferences.appearance} />
      <section className="management-page" aria-labelledby="merchants-title">
        <div className="page-heading">
          <p className="eyebrow">{t('eyebrow')}</p>
          <h1 id="merchants-title">{t('title')}</h1>
          <p>{t('description')}</p>
        </div>
        <MerchantsWorkspace labels={labels} />
      </section>
    </AccountShell>
  );
}
