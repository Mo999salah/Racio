import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import {
  AuthBoundaryError,
  getFinancialAccount,
  ensureUserPreferences,
  requireUser,
} from '@racio/auth';
import { AccountShell } from '../../../../components/account-shell';
import { ImportUploadWorkspace } from '../../../../components/import-upload-workspace';
import { ThemeSync } from '../../../../components/theme-sync';
import { database } from '../../../../lib/database';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function NewImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ accountId?: string }>;
}) {
  const { locale } = await params;
  let user;
  try {
    user = await requireUser(await headers());
  } catch (error) {
    if (!(error instanceof AuthBoundaryError)) throw error;
    redirect(`/${locale}/sign-in?returnTo=/${locale}/imports/new`);
  }
  const accountId = (await searchParams).accountId;
  if (!accountId) redirect(`/${locale}/accounts`);
  const account = await getFinancialAccount(database.db, user.id, accountId);
  const preferences = await ensureUserPreferences(database.db, user.id);
  const t = await getTranslations('imports');
  const keys = [
    'eyebrow',
    'title',
    'description',
    'chooseFile',
    'upload',
    'retention',
    'retentionHint',
    'reprocess',
    'busy',
    'error',
    'alreadyUploaded',
    'account',
  ];
  const labels = Object.fromEntries(keys.map((key) => [key, t(key)]));
  return (
    <AccountShell locale={locale} name={user.name}>
      <ThemeSync appearance={preferences.appearance} />
      <section className="accounts-page" aria-labelledby="import-title">
        <div className="page-heading">
          <p className="eyebrow">{t('eyebrow')}</p>
          <h1 id="import-title">{t('title')}</h1>
          <p>{t('description')}</p>
        </div>
        <ImportUploadWorkspace
          accountId={account.id}
          accountName={account.displayName}
          locale={locale}
          labels={labels}
        />
      </section>
    </AccountShell>
  );
}
