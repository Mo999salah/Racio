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
      'debit',
      'credit',
      'unknown',
      'valid',
      'excluded',
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
      'warnings',
      'rowWarning',
      'xlsxDiagnostics',
      'selectedWorksheet',
      'sourceRow',
      'cellCoordinate',
      'cellType',
      'numberFormat',
      'formulaCache',
      'notApplicable',
      'cachedValueAvailable',
      'cachedValueUnavailable',
      'warning_formula_cached_value',
      'warning_formula_value_unavailable',
      'warning_precision_normalized_from_display_format',
      'warning_ambiguous_booking_date',
      'warning_invalid_booking_date',
      'warning_invalid_amount',
      'warning_unknown_direction',
      'warning_missing_description',
      'warning_possible_summary_row',
      'pdfInspection',
      'pdfPages',
      'pdfTextExtraction',
      'pdfHasUsableText',
      'pdfImageOnly',
      'pdfLikelyImageOnly',
      'warnings',
    ].map((key) => [key, t(key)]),
  );
  const sourceMetadata =
    statement.sourceMetadata &&
    typeof statement.sourceMetadata === 'object' &&
    'selectedSheetName' in statement.sourceMetadata
      ? (statement.sourceMetadata as { selectedSheetName?: string })
      : null;
  const pdfInspection =
    statement.pdfInspection &&
    typeof statement.pdfInspection === 'object' &&
    'sourceType' in statement.pdfInspection &&
    statement.pdfInspection.sourceType === 'pdf'
      ? (statement.pdfInspection as {
          pageCount?: number;
          hasUsableText?: boolean;
          likelyImageOnly?: boolean;
          textUsability?: string;
          documentWarnings?: unknown;
        })
      : null;
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
                | 'inspecting'
                | 'needs_sheet_selection'
                | 'parsing'
                | 'needs_mapping'
                | 'needs_review'
                | 'ready'
                | 'imported'
                | 'failed',
            )}
          </p>
          {sourceMetadata?.selectedSheetName && (
            <p>
              {t('selectedWorksheet')}: {sourceMetadata.selectedSheetName}
            </p>
          )}
          {pdfInspection && (
            <details className="workbook-diagnostics">
              <summary>{labels.pdfInspection}</summary>
              <p>
                {labels.pdfPages}: {pdfInspection.pageCount}
              </p>
              <p>
                {labels.pdfTextExtraction}: {pdfInspection.textUsability ?? ''}
              </p>
              <p>
                {pdfInspection.hasUsableText
                  ? labels.pdfHasUsableText
                  : pdfInspection.likelyImageOnly
                    ? labels.pdfLikelyImageOnly
                    : labels.pdfImageOnly}
              </p>
              {Array.isArray(pdfInspection.documentWarnings) &&
                pdfInspection.documentWarnings.filter(
                  (warning): warning is string => typeof warning === 'string',
                ).length > 0 && (
                  <div className="row-warnings" role="status">
                    <strong>{labels.warnings}</strong>
                    <ul>
                      {pdfInspection.documentWarnings
                        .filter((warning): warning is string => typeof warning === 'string')
                        .map((warning) => (
                          <li key={warning}>{labels[`warning_${warning}`] ?? labels.rowWarning}</li>
                        ))}
                    </ul>
                  </div>
                )}
            </details>
          )}
        </div>
        <ImportReviewWorkspace
          statementId={id}
          locale={locale}
          advanced={preferences.interfaceMode === 'advanced'}
          labels={labels}
        />
      </section>
    </AccountShell>
  );
}
