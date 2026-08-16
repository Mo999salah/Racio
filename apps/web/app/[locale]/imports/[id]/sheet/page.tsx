import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { workbookInspectionSchema } from '@racio/contracts';
import { AuthBoundaryError, ensureUserPreferences, requireUser } from '@racio/auth';
import { getOwnedStatement } from '@racio/imports';
import { AccountShell } from '../../../../../components/account-shell';
import { ImportSheetWorkspace } from '../../../../../components/import-sheet-workspace';
import { ThemeSync } from '../../../../../components/theme-sync';
import { database } from '../../../../../lib/database';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ImportSheetPage({
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
  if (statement.sourceType !== 'xlsx') redirect(`/${locale}/imports/${id}/review`);
  const inspection = workbookInspectionSchema.safeParse(statement.workbookInspection);
  if (!inspection.success) redirect(`/${locale}/imports/${id}/review`);
  const t = await getTranslations('imports');
  const keys = [
    'sheetSelectionDescription',
    'hiddenSheet',
    'visibleSheet',
    'veryHiddenSheet',
    'selectSheet',
    'estimatedRows',
    'estimatedColumns',
    'populatedCells',
    'formulaCount',
    'mergedRangeCount',
    'sheetIndex',
    'warnings',
    'workbookWarning',
    'sampleRows',
    'column',
    'noUsableSheet',
    'busy',
    'error',
    'timeout',
    'error_XLSX_PARSER_TIMEOUT',
    'error_XLSX_INVALID_WORKBOOK',
    'error_XLSX_INVALID_XML',
    'error_XLSX_PATH_TRAVERSAL',
    'error_XLSX_ROW_LIMIT_EXCEEDED',
    'error_XLSX_COLUMN_LIMIT_EXCEEDED',
    'error_XLSX_CELL_LIMIT_EXCEEDED',
    'error_XLSX_FORMULA_LIMIT_EXCEEDED',
    'error_XLSX_MERGED_RANGE_LIMIT_EXCEEDED',
    'error_XLSX_STALE_SHEET_SELECTION',
    'error_XLSX_PARSE_FAILED',
    'warning_hidden_sheet',
    'warning_very_hidden_sheet',
    'warning_formulas_present',
    'warning_merged_cells_present',
    'warning_empty_sheet',
  ];
  const labels = Object.fromEntries(keys.map((key) => [key, t(key)]));
  return (
    <AccountShell locale={locale} name={user.name}>
      <ThemeSync appearance={preferences.appearance} />
      <section className="accounts-page" aria-labelledby="sheet-title">
        <div className="page-heading">
          <p className="eyebrow">{t('workbookInspection')}</p>
          <h1 id="sheet-title">{t('chooseWorksheet')}</h1>
          <p>{statement.originalFilename}</p>
        </div>
        <ImportSheetWorkspace
          statementId={id}
          locale={locale}
          sheets={inspection.data.sheets}
          advanced={preferences.interfaceMode === 'advanced'}
          labels={labels}
        />
      </section>
    </AccountShell>
  );
}
