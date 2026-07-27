import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import {
  AuthBoundaryError,
  ensureUserPreferences,
  listFinancialAccounts,
  listInstitutions,
  requireUser,
} from '@racio/auth';
import { AccountShell } from '../../../components/account-shell';
import { AccountsWorkspace } from '../../../components/accounts-workspace';
import { ThemeSync } from '../../../components/theme-sync';
import { database } from '../../../lib/database';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AccountsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  let user;
  try {
    user = await requireUser(await headers());
  } catch (error) {
    if (!(error instanceof AuthBoundaryError)) throw error;
    redirect(`/${locale}/sign-in?returnTo=/${locale}/accounts`);
  }
  const preferences = await ensureUserPreferences(database.db, user.id);
  const [institutions, accounts] = await Promise.all([
    listInstitutions(database.db, user.id),
    listFinancialAccounts(database.db, user.id),
  ]);
  const t = await getTranslations('accounts');
  const labels = Object.fromEntries(
    [
      'eyebrow',
      'title',
      'description',
      'institutions',
      'accountsList',
      'addInstitution',
      'addAccount',
      'institutionName',
      'country',
      'countryHint',
      'saveInstitution',
      'accountDisplayName',
      'institution',
      'selectInstitution',
      'accountType',
      'currency',
      'maskedIdentifier',
      'maskedIban',
      'maskedHint',
      'saveAccount',
      'saveChanges',
      'edit',
      'cancel',
      'archive',
      'restore',
      'archiveConfirm',
      'restoreConfirm',
      'showArchived',
      'hideArchived',
      'active',
      'archived',
      'checking',
      'savings',
      'credit',
      'cash',
      'other',
      'emptyInstitutions',
      'emptyAccounts',
      'advancedDetails',
      'created',
      'updated',
      'required',
      'error',
      'conflictInstitution',
      'conflictAccount',
      'invalidMasked',
      'success',
      'importCsv',
    ].map((key) => [key, t(key)]),
  ) as Record<string, string>;
  const serialisedAccounts = accounts.map((account) => ({
    ...account,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  }));
  return (
    <AccountShell locale={locale} name={user.name}>
      <ThemeSync appearance={preferences.appearance} />
      <section className="accounts-page" aria-labelledby="accounts-title">
        <div className="page-heading">
          <p className="eyebrow">{t('eyebrow')}</p>
          <h1 id="accounts-title">{t('title')}</h1>
          <p>{t('description')}</p>
        </div>
        <AccountsWorkspace
          initialInstitutions={institutions.map((institution) => ({
            id: institution.id,
            name: institution.name,
            countryCode: institution.countryCode,
          }))}
          initialAccounts={serialisedAccounts}
          locale={locale}
          advanced={preferences.interfaceMode === 'advanced'}
          labels={labels}
        />
      </section>
    </AccountShell>
  );
}
