import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { AuthBoundaryError, ensureUserPreferences, requireUser } from '@racio/auth';
import { countOwnedTransactions } from '@racio/export';
import { exportTransactionFiltersSchema } from '@racio/contracts';
import { AccountShell } from '../../../components/account-shell';
import { ThemeSync } from '../../../components/theme-sync';
import { ExportWorkspace } from '../../../components/export-workspace';
import { database } from '../../../lib/database';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const FILTER_KEYS = [
  'dateFrom',
  'dateTo',
  'accountId',
  'institutionId',
  'direction',
  'currency',
  'primaryCategoryId',
  'secondaryCategoryId',
  'tagId',
  'reviewed',
  'categorised',
  'statementId',
  'search',
  'amountExact',
  'amountMin',
  'amountMax',
  'includeArchived',
  'savedViewId',
] as const;

export default async function ExportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const rawSearchParams = await searchParams;
  let user;
  try {
    user = await requireUser(await headers());
  } catch (error) {
    if (!(error instanceof AuthBoundaryError)) throw error;
    redirect(`/${locale}/sign-in?returnTo=/${locale}/export`);
  }
  const preferences = await ensureUserPreferences(database.db, user.id);
  const t = await getTranslations('export');
  const txLabels = await getTranslations('transactions');
  const labels = Object.fromEntries(
    [
      'eyebrow',
      'title',
      'description',
      'transactionsHeading',
      'transactionsBody',
      'archiveHeading',
      'archiveBody',
      'scope',
      'noScope',
      'format',
      'formatCsv',
      'formatXlsx',
      'includeNotes',
      'includeNotesHint',
      'includeSplits',
      'includeSplitsHint',
      'includeAdvisor',
      'includeAdvisorHint',
      'estimatedRows',
      'generate',
      'generating',
      'history',
      'historyEmpty',
      'status',
      'preparing',
      'ready',
      'failed',
      'expired',
      'type',
      'typeTransactionsCsv',
      'typeTransactionsXlsx',
      'typeAccountArchive',
      'download',
      'delete',
      'deleteConfirm',
      'fileExpires',
      'generatedDate',
      'size',
      'rows',
      'privacyTitle',
      'privacyBody',
      'error',
      'busy',
      'tooManyRows',
      'noMatching',
      'expiryHours',
      'filterSummary',
      'clearScope',
    ].map((key) => [key, t(key)]),
  ) as Record<string, string>;
  const txLabelMap = Object.fromEntries(
    [
      'date',
      'account',
      'institution',
      'direction',
      'debit',
      'credit',
      'unknown',
      'currency',
      'category',
      'reviewed',
      'notReviewed',
      'search',
      'amountExact',
      'amountMin',
      'amountMax',
      'categorised',
      'categorisedYes',
      'includeArchived',
      'allDirections',
      'any',
    ].map((key) => [key, txLabels(key)]),
  ) as Record<string, string>;

  const query = Object.fromEntries(
    Object.entries(rawSearchParams).flatMap(([key, value]) =>
      typeof value === 'string' ? [[key, value]] : [],
    ),
  );
  const filterKeysPresent = FILTER_KEYS.some((key) => rawSearchParams[key] !== undefined);
  const parsed = exportTransactionFiltersSchema.safeParse(query);
  const initialFilters = parsed.success && filterKeysPresent ? parsed.data : null;
  let estimatedRows = 0;
  if (initialFilters) {
    try {
      estimatedRows = await countOwnedTransactions(database.db, user.id, initialFilters);
    } catch {
      estimatedRows = -1;
    }
  }

  return (
    <AccountShell locale={locale} name={user.name}>
      <ThemeSync appearance={preferences.appearance} />
      <section className="export-page" aria-labelledby="export-title">
        <div className="page-heading">
          <p className="eyebrow">{labels.eyebrow}</p>
          <h1 id="export-title">{labels.title}</h1>
          <p>{labels.description}</p>
        </div>
        <ExportWorkspace
          labels={labels}
          txLabels={txLabelMap}
          locale={locale}
          advanced={preferences.interfaceMode === 'advanced'}
          initialFilters={initialFilters}
          estimatedRows={estimatedRows}
        />
      </section>
    </AccountShell>
  );
}
