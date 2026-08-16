import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { AuthBoundaryError, ensureUserPreferences, requireUser } from '@racio/auth';
import { getOwnedStatement } from '@racio/imports';
import { AccountShell } from '../../../../../components/account-shell';
import { ImportSummaryWorkspace } from '../../../../../components/import-summary-workspace';
import { ThemeSync } from '../../../../../components/theme-sync';
import { database } from '../../../../../lib/database';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ImportSummaryPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  let user;
  try {
    user = await requireUser(await headers());
  } catch (error) {
    if (!(error instanceof AuthBoundaryError)) throw error;
    redirect(`/${locale}/sign-in`);
  }
  const [statement, preferences] = await Promise.all([
    getOwnedStatement(database.db, user.id, id),
    ensureUserPreferences(database.db, user.id),
  ]);
  const t = await getTranslations('imports');
  const labels = Object.fromEntries(
    [
      'status',
      'checksum',
      'sourceFile',
      'reconciliation',
      'matched',
      'mismatch',
      'unverifiable',
      'confirmMismatch',
      'confirmDescription',
      'busy',
      'confirm',
      'error',
      'sourceType',
      'selectedWorksheet',
      'bytes',
      'uploaded',
      'inspecting',
      'needs_sheet_selection',
      'parsing',
      'needs_mapping',
      'needs_review',
      'ready',
      'imported',
      'failed',
    ].map((key) => [key, t(key)]),
  );
  return (
    <AccountShell locale={locale} name={user.name}>
      <ThemeSync appearance={preferences.appearance} />
      <section className="accounts-page" aria-labelledby="summary-title">
        <div className="page-heading">
          <p className="eyebrow">{t('summary')}</p>
          <h1 id="summary-title">{statement.originalFilename}</h1>
        </div>
        <ImportSummaryWorkspace
          statementId={id}
          locale={locale}
          statement={statement}
          labels={labels}
        />
      </section>
    </AccountShell>
  );
}
