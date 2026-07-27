import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { AuthBoundaryError, ensureUserPreferences, requireUser } from '@racio/auth';
import { getOwnedStatement } from '@racio/imports';
import { AccountShell } from '../../../../../components/account-shell';
import { ImportReviewWorkspace } from '../../../../../components/import-review-workspace';
import { ThemeSync } from '../../../../../components/theme-sync';
import { database } from '../../../../../lib/database';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ImportReviewPage({
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
      'reviewDescription',
      'row',
      'date',
      'descriptionField',
      'amount',
      'valid',
      'needs_review',
      'invalid',
      'duplicate_candidate',
      'restore',
      'markReviewed',
      'markAllReviewed',
      'exclude',
      'confirm',
      'empty',
      'error',
    ].map((key) => [key, t(key)]),
  );
  return (
    <AccountShell locale={locale} name={user.name}>
      <ThemeSync appearance={preferences.appearance} />
      <section className="accounts-page" aria-labelledby="review-title">
        <div className="page-heading">
          <p className="eyebrow">{t('review')}</p>
          <h1 id="review-title">{statement.originalFilename}</h1>
          <p>
            {t(
              statement.processingStatus as
                | 'uploaded'
                | 'parsing'
                | 'needs_mapping'
                | 'needs_review'
                | 'ready'
                | 'imported'
                | 'failed',
            )}
          </p>
        </div>
        <ImportReviewWorkspace statementId={id} locale={locale} labels={labels} />
      </section>
    </AccountShell>
  );
}
