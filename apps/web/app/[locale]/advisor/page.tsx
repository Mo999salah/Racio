import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { AuthBoundaryError, ensureUserPreferences, requireUser } from '@racio/auth';
import { getAdvisorStatus } from '@racio/advisor';
import { AccountShell } from '../../../components/account-shell';
import { ThemeSync } from '../../../components/theme-sync';
import { AdvisorWorkspace } from '../../../components/advisor-workspace';
import { getAiRuntime } from '../../../lib/ai-runtime';
import { database } from '../../../lib/database';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const LABEL_KEYS = [
  'eyebrow',
  'title',
  'description',
  'askLabel',
  'askPlaceholder',
  'submit',
  'newThread',
  'loading',
  'aiDisabledTitle',
  'aiDisabledBody',
  'privacyTitle',
  'privacyBody',
  'privacyContinue',
  'scope',
  'dateRange',
  'currency',
  'account',
  'allAccounts',
  'allCurrencies',
  'name',
  'amount',
  'period',
  'weekly',
  'monthly',
  'yearly',
  'date',
  'importedDescription',
  'verified',
  'verifiedFactsHeading',
  'proposedAction',
  'preview',
  'confirm',
  'cancel',
  'proposalCreated',
  'proposalExecuted',
  'staleProposal',
  'tamperedProposal',
  'unsupported',
  'clarificationTitle',
  'clarificationMessage',
  'clarificationThisMonth',
  'clarificationLastMonth',
  'clarificationLast30',
  'clarificationYtd',
  'conversations',
  'conversationsEmpty',
  'conversationUntitled',
  'conversationView',
  'conversationArchive',
  'conversationRestore',
  'conversationDelete',
  'conversationConfirmDelete',
  'conversationArchived',
  'conversationMessages',
  'conversationYou',
  'conversationAssistant',
  'suggestionSpending',
  'suggestionCategories',
  'suggestionBudget',
  'suggestionUncategorized',
  'suggestionGoal',
  'disclaimer',
  'providerStatus',
  'disabled',
  'showAdvanced',
  'hideAdvanced',
  'searchResults',
  'searchResultsEmpty',
  'noData',
  'accountUnavailable',
] as const;

const ERROR_KEYS = [
  'AI_DISABLED',
  'AI_PROVIDER_UNAVAILABLE',
  'AI_PROVIDER_ERROR',
  'AI_TIMEOUT',
  'AI_RATE_LIMITED',
  'AI_INVALID_TOOL_CALL',
  'AI_UNSAFE_PROPOSAL',
  'AI_STALE_PROPOSAL',
  'AI_CONTEXT_LIMIT',
  'AI_RESPONSE_INVALID',
  'INTERNAL',
] as const;

export default async function AdvisorPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const requestHeaders = await headers();
  let user;
  try {
    user = await requireUser(requestHeaders);
  } catch (error) {
    if (!(error instanceof AuthBoundaryError)) throw error;
    redirect(`/${locale}/sign-in?returnTo=/${locale}/advisor`);
  }
  const preferences = await ensureUserPreferences(database.db, user.id);
  const status = getAdvisorStatus(getAiRuntime());
  const t = await getTranslations('advisor');
  const labels = Object.fromEntries(LABEL_KEYS.map((key) => [key, t(key)])) as Record<
    string,
    string
  >;
  const errorLabels = Object.fromEntries(
    ERROR_KEYS.map((key) => [key, t(`errors.${key}`)]),
  ) as Record<string, string>;

  return (
    <AccountShell locale={locale} name={user.name}>
      <ThemeSync appearance={preferences.appearance} />
      <section className="advisor-page" aria-labelledby="advisor-title">
        <div className="page-heading">
          <p className="eyebrow">{t('eyebrow')}</p>
          <h1 id="advisor-title">{t('title')}</h1>
          <p>{t('description')}</p>
        </div>
        <AdvisorWorkspace
          locale={locale}
          advanced={preferences.interfaceMode === 'advanced'}
          status={status}
          labels={labels}
          errorLabels={errorLabels}
        />
      </section>
    </AccountShell>
  );
}
