import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { AuthBoundaryError, ensureUserPreferences, requireUser } from '@racio/auth';
import { AccountShell } from '../../../components/account-shell';
import { TransfersWorkspace } from '../../../components/transfers-workspace';
import { ThemeSync } from '../../../components/theme-sync';
import { database } from '../../../lib/database';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function TransfersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  let user;
  try {
    user = await requireUser(await headers());
  } catch (error) {
    if (!(error instanceof AuthBoundaryError)) throw error;
    redirect(`/${locale}/sign-in?returnTo=/${locale}/transfers`);
  }
  const preferences = await ensureUserPreferences(database.db, user.id);
  const t = await getTranslations('transfers');
  const labels = Object.fromEntries(
    [
      'outgoing',
      'incoming',
      'link',
      'saved',
      'error',
      'empty',
      'confirm',
      'reject',
      'unlink',
      'suggested',
      'confirmed',
      'rejected',
      'unlinked',
    ].map((key) => [key, t(key)]),
  );
  return (
    <AccountShell locale={locale} name={user.name}>
      <ThemeSync appearance={preferences.appearance} />
      <section className="management-page" aria-labelledby="transfers-title">
        <div className="page-heading">
          <p className="eyebrow">{t('eyebrow')}</p>
          <h1 id="transfers-title">{t('title')}</h1>
          <p>{t('description')}</p>
        </div>
        <TransfersWorkspace labels={labels} />
      </section>
    </AccountShell>
  );
}
