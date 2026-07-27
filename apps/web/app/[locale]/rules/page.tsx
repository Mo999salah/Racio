import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { AuthBoundaryError, ensureUserPreferences, requireUser } from '@racio/auth';
import { AccountShell } from '../../../components/account-shell';
import { RulesWorkspace } from '../../../components/rules-workspace';
import { ThemeSync } from '../../../components/theme-sync';
import { database } from '../../../lib/database';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function RulesPage({
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
    redirect(`/${locale}/sign-in?returnTo=/${locale}/rules`);
  }
  const preferences = await ensureUserPreferences(database.db, user.id);
  const t = await getTranslations('rules');
  const labels = Object.fromEntries(
    [
      'name',
      'matches',
      'primaryCategory',
      'enabled',
      'skipped',
      'futureOnly',
      'historicalAndFuture',
      'create',
      'preview',
      'applyHistorical',
      'confirmHistorical',
      'noRules',
      'error',
      'editRule',
      'createRule',
      'newRule',
      'saveRule',
      'builderHint',
      'conditions',
      'actions',
      'field',
      'operator',
      'action',
      'actionValue',
      'addCondition',
      'removeCondition',
      'addAction',
      'removeAction',
      'remove',
      'addTag',
      'chooseAccount',
      'chooseInstitution',
      'chooseTag',
      'chooseDirection',
      'chooseCategory',
      'allConditions',
      'anyCondition',
      'matchMode',
      'showArchived',
      'disabled',
      'edit',
      'disable',
      'enable',
      'archive',
      'restore',
      'archived',
      'manualProtection',
      'stalePreview',
      'dateRange',
      'accounts',
      'previewLimited',
      'reverted',
      'noHistory',
      'confirmRevert',
      'confirm',
      'cancel',
      'close',
      'nameRequired',
      'conditionRequired',
      'conditionValueRequired',
      'amountCurrencyRequired',
      'actionRequired',
      'onePrimary',
      'actionValueRequired',
      'invalidAmount',
      'yes',
      'no',
      'reviewed',
      'description',
      'counterparty',
      'amount',
      'currency',
      'direction',
      'account',
      'institution',
      'existing_tag',
      'booking_day',
      'uncategorised_only',
      'statement_source_type',
      'contains',
      'starts_with',
      'equals',
      'minimum',
      'maximum',
    ].map((key) => [key, t(key)]),
  );
  return (
    <AccountShell locale={locale} name={user.name}>
      <ThemeSync appearance={preferences.appearance} />
      <section className="management-page" aria-labelledby="rules-title">
        <div className="page-heading">
          <p className="eyebrow">{t('eyebrow')}</p>
          <h1 id="rules-title">{t('title')}</h1>
          <p>{t('description')}</p>
        </div>
        <RulesWorkspace
          labels={labels}
          advanced={preferences.interfaceMode === 'advanced'}
          initialTransactionId={
            typeof rawSearchParams.fromTransaction === 'string'
              ? rawSearchParams.fromTransaction
              : undefined
          }
        />
      </section>
    </AccountShell>
  );
}
