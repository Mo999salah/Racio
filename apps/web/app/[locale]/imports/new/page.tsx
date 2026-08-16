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
    'institution',
    'accountCurrency',
    'selectedFile',
    'bytes',
    'workbookSecurityTitle',
    'workbookSecurityNotice',
    'workbookUnsupportedNotice',
    'legacyExcelNotice',
    'timeout',
    'error_XLSX_UNSUPPORTED_LEGACY_EXCEL',
    'error_XLSX_MACRO_ENABLED',
    'error_XLSX_INVALID_WORKBOOK',
    'error_XLSX_INVALID_XML',
    'error_XLSX_PATH_TRAVERSAL',
    'error_XLSX_ARCHIVE_LIMIT_EXCEEDED',
    'error_XLSX_PASSWORD_PROTECTED',
    'error_XLSX_EXTERNAL_LINKS_UNSUPPORTED',
    'error_XLSX_UNSUPPORTED_CONTENT',
    'error_XLSX_NO_USABLE_SHEET',
    'error_XLSX_SHEET_LIMIT_EXCEEDED',
    'error_XLSX_ROW_LIMIT_EXCEEDED',
    'error_XLSX_COLUMN_LIMIT_EXCEEDED',
    'error_XLSX_CELL_LIMIT_EXCEEDED',
    'error_XLSX_SHARED_STRING_LIMIT_EXCEEDED',
    'error_XLSX_CELL_STRING_LIMIT_EXCEEDED',
    'error_XLSX_FORMULA_LIMIT_EXCEEDED',
    'error_XLSX_MERGED_RANGE_LIMIT_EXCEEDED',
    'error_XLSX_PARSER_TIMEOUT',
    'error_XLSX_STALE_SHEET_SELECTION',
    'error_XLSX_INSPECTION_FAILED',
    'error_XLSX_PARSE_FAILED',
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
          institutionName={account.institutionName}
          accountCurrency={account.currencyCode}
          locale={locale}
          labels={labels}
        />
      </section>
    </AccountShell>
  );
}
