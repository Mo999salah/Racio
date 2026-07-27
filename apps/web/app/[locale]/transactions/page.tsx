import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { AuthBoundaryError, ensureUserPreferences, requireUser } from '@racio/auth';
import { AccountShell } from '../../../components/account-shell';
import { ThemeSync } from '../../../components/theme-sync';
import { TransactionsWorkspace } from '../../../components/transactions-workspace';
import { database } from '../../../lib/database';
import { transactionListQuerySchema } from '@racio/contracts';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function TransactionsPage({
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
    redirect(`/${locale}/sign-in?returnTo=/${locale}/transactions`);
  }
  const preferences = await ensureUserPreferences(database.db, user.id);
  const t = await getTranslations('transactions');
  const labels = Object.fromEntries(
    [
      'search',
      'reviewed',
      'notReviewed',
      'applyFilters',
      'clearFilters',
      'date',
      'descriptionField',
      'amount',
      'category',
      'uncategorised',
      'empty',
      'previous',
      'next',
      'details',
      'userDescription',
      'importedDescription',
      'counterparty',
      'note',
      'saveDetails',
      'primaryCategory',
      'secondaryCategories',
      'tags',
      'saveClassification',
      'advanced',
      'saved',
      'error',
      'selected',
      'markReviewed',
      'markUnreviewed',
      'savedViews',
      'currentView',
      'viewName',
      'saveView',
      'updateView',
      'manageViews',
      'defaultView',
      'invalidView',
      'advancedFilters',
      'sort',
      'newest',
      'oldest',
      'amountLow',
      'amountHigh',
      'descriptionAsc',
      'descriptionDesc',
      'account',
      'institution',
      'allInstitutions',
      'allDirections',
      'direction',
      'debit',
      'credit',
      'unknown',
      'currency',
      'allCategories',
      'allTags',
      'amountExact',
      'amountMin',
      'amountMax',
      'categorised',
      'categorisedYes',
      'any',
      'includeArchived',
      'createRuleFromTransaction',
      'close',
      'setDefault',
      'rename',
      'delete',
      'splits',
      'splitHint',
      'startSplitting',
      'addSplit',
      'saveSplits',
      'splitSaved',
      'remove',
      'merchant',
      'unassigned',
      'saveMerchant',
    ].map((key) => [key, t(key)]),
  );
  const query = Object.fromEntries(
    Object.entries(rawSearchParams).flatMap(([key, value]) =>
      typeof value === 'string' ? [[key, value]] : [],
    ),
  );
  const parsedQuery = transactionListQuerySchema.safeParse(query);
  const initialFilters = parsedQuery.success
    ? Object.fromEntries(
        Object.entries(parsedQuery.data).filter(
          ([key]) => !['limit', 'offset', 'sort'].includes(key),
        ),
      )
    : {};
  const filterKeys = [
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
  ];
  const hasExplicitFilters = filterKeys.some((key) => rawSearchParams[key] !== undefined);
  return (
    <AccountShell locale={locale} name={user.name}>
      <ThemeSync appearance={preferences.appearance} />
      <section className="transactions-page" aria-labelledby="transactions-title">
        <div className="page-heading">
          <p className="eyebrow">{t('eyebrow')}</p>
          <h1 id="transactions-title">{t('title')}</h1>
          <p>{t('description')}</p>
        </div>
        <TransactionsWorkspace
          labels={labels}
          advanced={preferences.interfaceMode === 'advanced'}
          locale={locale}
          initialFilters={initialFilters}
          hasExplicitFilters={hasExplicitFilters}
        />
      </section>
    </AccountShell>
  );
}
