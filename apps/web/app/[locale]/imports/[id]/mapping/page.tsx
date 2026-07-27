import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { AuthBoundaryError, ensureUserPreferences, requireUser } from '@racio/auth';
import { getOwnedStatement } from '@racio/imports';
import { AccountShell } from '../../../../../components/account-shell';
import { ImportMappingWorkspace } from '../../../../../components/import-mapping-workspace';
import { ThemeSync } from '../../../../../components/theme-sync';
import { database } from '../../../../../lib/database';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ImportMappingPage({
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
    ['mappingDescription', 'date', 'busy', 'saveMapping', 'error'].map((key) => [key, t(key)]),
  );
  return (
    <AccountShell locale={locale} name={user.name}>
      <ThemeSync appearance={preferences.appearance} />
      <section className="accounts-page" aria-labelledby="mapping-title">
        <div className="page-heading">
          <p className="eyebrow">{t('mapping')}</p>
          <h1 id="mapping-title">{statement.originalFilename}</h1>
        </div>
        <ImportMappingWorkspace
          statementId={id}
          locale={locale}
          initial={(statement.mappingSnapshot as Record<string, unknown> | null) ?? null}
          advanced={preferences.interfaceMode === 'advanced'}
          labels={labels}
        />
      </section>
    </AccountShell>
  );
}
