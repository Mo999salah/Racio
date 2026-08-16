'use client';

import { useRouter } from 'next/navigation';

type DashboardSummary = {
  period: { from: string; to: string; isDefault: boolean };
  hasAccounts: boolean;
  hasTransactions: boolean;
  currencies: string[];
  cashFlow: Array<{
    currency: string;
    inflow: string;
    outflow: string;
    net: string;
    count: number;
    unresolvedCount: number;
  }>;
  accounts: Array<{
    id: string;
    name: string;
    currency: string;
    status: string;
    transactionCount: number;
    netActivity: string;
    balance: {
      amount: string;
      currency: string;
      asOfDate: string;
      source: 'transaction_balance_after' | 'statement_closing_balance';
      sourceId: string;
    } | null;
    hasData: boolean;
  }>;
  categories: Array<{
    currency: string;
    name: string | null;
    amount: string;
    sharePercent: string;
    count: number;
  }>;
  merchants: Array<{
    currency: string;
    name: string;
    amount: string;
    sharePercent: string;
    count: number;
  }>;
  attention: {
    unreviewed: number;
    statementsNeedingAction: number;
    reconciliationMismatch: number;
    items: Array<{
      kind: 'statement_needs_action' | 'reconciliation_mismatch';
      statementId: string;
      filename: string;
      processingStatus?: string;
      reconciliationStatus?: string;
    }>;
  };
};

function money(amount: string, currency: string) {
  return `${amount} ${currency}`;
}

function signedMoney(amount: string, currency: string) {
  const negative = amount.startsWith('-');
  const display = negative ? amount.slice(1) : amount;
  return `${negative ? '−' : '+'}${money(display, currency)}`;
}

function groupByCurrency<T extends { currency: string }>(rows: T[]) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const list = grouped.get(row.currency) ?? [];
    list.push(row);
    grouped.set(row.currency, list);
  }
  return grouped;
}

function formatDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00Z`));
}

type PlanningSummary = {
  budgets: Array<{
    id: string;
    name: string;
    currency: string;
    spent: string;
    limit: string;
    status: string;
  }>;
  goalsNeedingAttention: number;
  unreadAlerts: number;
};

export function DashboardWorkspace({
  locale,
  advanced,
  summary,
  planning,
  labels,
  periodOptions,
  currentPeriod,
}: {
  locale: string;
  advanced: boolean;
  summary: DashboardSummary;
  planning?: PlanningSummary;
  labels: Record<string, string>;
  periodOptions: Array<{ value: string; label: string }>;
  currentPeriod: string;
}) {
  const router = useRouter();
  const text = (key: string) => labels[key] ?? '';

  function changePeriod(event: React.ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value;
    router.push(`/${locale}${value === 'last30' ? '' : `?period=${value}`}`);
  }

  const hasAnyAttention =
    summary.attention.unreviewed > 0 ||
    summary.attention.statementsNeedingAction > 0 ||
    summary.attention.reconciliationMismatch > 0;

  const categoryGroups = [...groupByCurrency(summary.categories).entries()];
  const merchantGroups = [...groupByCurrency(summary.merchants).entries()];
  const allCurrencyCodes = Array.from(
    new Set([
      ...summary.categories.map((row) => row.currency),
      ...summary.merchants.map((row) => row.currency),
    ]),
  );

  return (
    <section className="dashboard-page" aria-labelledby="dashboard-title">
      <div className="page-heading">
        <p className="eyebrow">{text('eyebrow')}</p>
        <h1 id="dashboard-title">{text('title')}</h1>
        <p>{text('description')}</p>
      </div>

      <div className="dashboard-period">
        <label>
          <span className="period-label">{text('period')}</span>
          <select value={currentPeriod} onChange={changePeriod}>
            {periodOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <p className="period-range" aria-live="polite">
          <bdi>{formatDate(summary.period.from, locale)}</bdi>
          <span aria-hidden="true"> – </span>
          <bdi>{formatDate(summary.period.to, locale)}</bdi>
        </p>
      </div>

      {!summary.hasAccounts ? (
        <section className="dashboard-empty" aria-labelledby="dashboard-empty-title">
          <p className="panel-kicker" id="dashboard-empty-title">
            {text('accountsEmptyTitle')}
          </p>
          <p className="dashboard-empty-body">{text('accountsEmptyBody')}</p>
          <a className="primary-button" href={`/${locale}/accounts`}>
            {text('addAccount')}
          </a>
        </section>
      ) : (
        <>
          <section className="dashboard-section" aria-labelledby="accounts-heading">
            <div className="dashboard-section-heading">
              <h2 id="accounts-heading">{text('accountsHeading')}</h2>
              <a className="text-button" href={`/${locale}/accounts`}>
                {text('addAccount')}
              </a>
            </div>
            <div className="dashboard-account-list">
              {summary.accounts.map((account) => (
                <div className="dashboard-account-row" key={account.id}>
                  <div className="dashboard-account-name">
                    <strong>{account.name}</strong>
                    <span className="dashboard-muted">{account.currency}</span>
                  </div>
                  <div className="dashboard-account-figure">
                    {account.hasData ? (
                      <>
                        <span
                          className={
                            account.netActivity.startsWith('-') ? 'amount-debit' : 'amount-credit'
                          }
                        >
                          {signedMoney(account.netActivity, account.currency)}
                        </span>
                        {advanced && account.transactionCount > 0 ? (
                          <span className="dashboard-muted">
                            {account.transactionCount} {text('transactionsCount')}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span className="dashboard-muted">{text('accountNoData')}</span>
                    )}
                  </div>
                  {account.balance ? (
                    <p className="dashboard-account-balance dashboard-muted">
                      {text('balance')}: {money(account.balance.amount, account.balance.currency)}
                      {advanced ? ` · ${text('balanceAsOf')} ${account.balance.asOfDate}` : ''}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          {!summary.hasTransactions ? (
            <section className="dashboard-partial" aria-labelledby="no-transactions-title">
              <p className="panel-kicker" id="no-transactions-title">
                {text('noTransactionsTitle')}
              </p>
              <p className="dashboard-empty-body">{text('noTransactionsBody')}</p>
              <a className="primary-button" href={`/${locale}/imports/new`}>
                {text('importStatement')}
              </a>
            </section>
          ) : (
            <>
              <section className="dashboard-section" aria-labelledby="cashflow-heading">
                <div className="dashboard-section-heading">
                  <h2 id="cashflow-heading">{text('net')}</h2>
                </div>
                {summary.cashFlow.map((row) => (
                  <div className="dashboard-cashflow" key={row.currency}>
                    <span className="dashboard-currency-tag">{row.currency}</span>
                    <dl className="dashboard-cashflow-figures">
                      <div>
                        <dt>{text('inflow')}</dt>
                        <dd className="amount-credit">{money(row.inflow, row.currency)}</dd>
                      </div>
                      <div>
                        <dt>{text('outflow')}</dt>
                        <dd className="amount-debit">{money(row.outflow, row.currency)}</dd>
                      </div>
                      <div>
                        <dt>{text('net')}</dt>
                        <dd className={row.net.startsWith('-') ? 'amount-debit' : 'amount-credit'}>
                          {signedMoney(row.net, row.currency)}
                        </dd>
                      </div>
                    </dl>
                    {row.unresolvedCount > 0 ? (
                      <p className="dashboard-warning">
                        {text('unresolved')} · {row.unresolvedCount}
                      </p>
                    ) : null}
                  </div>
                ))}
              </section>

              <section className="dashboard-section" aria-labelledby="where-money-went">
                <h2 id="where-money-went">{text('whereMoneyWent')}</h2>
                <div className="dashboard-breakdown">
                  <div className="dashboard-breakdown-column">
                    <h3>{text('categoriesHeading')}</h3>
                    {allCurrencyCodes.length === 0 || categoryGroups.length === 0 ? (
                      <p className="dashboard-muted">{text('noCategories')}</p>
                    ) : (
                      allCurrencyCodes.map((currency) => (
                        <div key={currency}>
                          {allCurrencyCodes.length > 1 ? (
                            <span className="dashboard-currency-tag">{currency}</span>
                          ) : null}
                          <ul className="dashboard-rank-list">
                            {(groupByCurrency(summary.categories).get(currency) ?? []).map(
                              (row, index) => (
                                <li
                                  className="dashboard-rank-row"
                                  key={`${currency}-${row.name ?? 'uncategorized'}-${index}`}
                                >
                                  <span className="dashboard-rank-name">
                                    {row.name ?? text('uncategorized')}
                                  </span>
                                  <span className="dashboard-rank-bar" aria-hidden="true">
                                    <span
                                      className="dashboard-rank-fill"
                                      style={{ width: `${row.sharePercent}%` }}
                                    />
                                  </span>
                                  <span className="dashboard-rank-amount">
                                    {money(row.amount, currency)}
                                  </span>
                                </li>
                              ),
                            )}
                          </ul>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="dashboard-breakdown-column">
                    <h3>{text('merchantsHeading')}</h3>
                    {allCurrencyCodes.length === 0 || merchantGroups.length === 0 ? (
                      <p className="dashboard-muted">{text('noMerchants')}</p>
                    ) : (
                      allCurrencyCodes.map((currency) => (
                        <div key={currency}>
                          {allCurrencyCodes.length > 1 ? (
                            <span className="dashboard-currency-tag">{currency}</span>
                          ) : null}
                          <ul className="dashboard-rank-list">
                            {(groupByCurrency(summary.merchants).get(currency) ?? []).map(
                              (row, index) => (
                                <li
                                  className="dashboard-rank-row"
                                  key={`${currency}-${row.name}-${index}`}
                                >
                                  <span className="dashboard-rank-name">{row.name}</span>
                                  <span className="dashboard-rank-bar" aria-hidden="true">
                                    <span
                                      className="dashboard-rank-fill"
                                      style={{ width: `${row.sharePercent}%` }}
                                    />
                                  </span>
                                  <span className="dashboard-rank-amount">
                                    {money(row.amount, currency)}
                                  </span>
                                </li>
                              ),
                            )}
                          </ul>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </section>
            </>
          )}

          <section className="dashboard-section" aria-labelledby="attention-heading">
            <h2 id="attention-heading">{text('attention')}</h2>
            {!hasAnyAttention ? (
              <p className="dashboard-muted">{text('attentionEmpty')}</p>
            ) : (
              <div className="dashboard-attention">
                {summary.attention.unreviewed > 0 ? (
                  <a
                    className="dashboard-attention-row"
                    href={`/${locale}/transactions?reviewed=false`}
                  >
                    <span className="dashboard-attention-count">
                      {summary.attention.unreviewed}
                    </span>
                    <span>
                      <strong>{text('unreviewedTitle')}</strong>
                      <span className="dashboard-muted">{text('unreviewedBody')}</span>
                    </span>
                  </a>
                ) : null}
                {summary.attention.items.map((item) => (
                  <a
                    className="dashboard-attention-row dashboard-attention-item"
                    href={`/${locale}/imports/${item.statementId}/review`}
                    key={item.statementId}
                  >
                    <span>
                      <strong>{item.filename}</strong>
                      <span
                        className={
                          item.kind === 'reconciliation_mismatch'
                            ? 'dashboard-muted dashboard-mismatch'
                            : 'dashboard-muted'
                        }
                      >
                        {item.kind === 'reconciliation_mismatch'
                          ? text('reconciliationMismatchTitle')
                          : text('statementsNeedingActionTitle')}
                      </span>
                    </span>
                  </a>
                ))}
                {summary.attention.statementsNeedingAction +
                  summary.attention.reconciliationMismatch >
                summary.attention.items.length ? (
                  <p className="dashboard-muted dashboard-attention-more">
                    {text('statementsNeedingActionTitle')} ·{' '}
                    {summary.attention.statementsNeedingAction +
                      summary.attention.reconciliationMismatch}
                  </p>
                ) : null}
              </div>
            )}
          </section>

          {planning ? (
            <section className="dashboard-section" aria-labelledby="planning-heading">
              <div className="dashboard-section-heading">
                <h2 id="planning-heading">{text('planning')}</h2>
              </div>
              {planning.budgets.length === 0 &&
              planning.goalsNeedingAttention === 0 &&
              planning.unreadAlerts === 0 ? (
                <p className="dashboard-muted">{text('noPlanningAttention')}</p>
              ) : (
                <div className="dashboard-attention">
                  {planning.budgets.map((budget) => (
                    <a
                      className="dashboard-attention-row dashboard-attention-item"
                      href={`/${locale}/budgets`}
                      key={budget.id}
                    >
                      <span>
                        <strong>{budget.name}</strong>
                        <span
                          className={
                            budget.status === 'exceeded'
                              ? 'dashboard-muted dashboard-mismatch'
                              : 'dashboard-muted'
                          }
                        >
                          {budget.spent} / {budget.limit} {budget.currency} ·{' '}
                          {text(budget.status === 'exceeded' ? 'exceeded' : 'approaching')}
                        </span>
                      </span>
                    </a>
                  ))}
                  {planning.goalsNeedingAttention > 0 ? (
                    <a
                      className="dashboard-attention-row dashboard-attention-item"
                      href={`/${locale}/goals`}
                    >
                      <span className="dashboard-attention-count">
                        {planning.goalsNeedingAttention}
                      </span>
                      <span>
                        <strong>{text('goalNeedsAttention')}</strong>
                      </span>
                    </a>
                  ) : null}
                  {planning.unreadAlerts > 0 ? (
                    <a
                      className="dashboard-attention-row dashboard-attention-item"
                      href={`/${locale}/alerts`}
                    >
                      <span className="dashboard-attention-count">{planning.unreadAlerts}</span>
                      <span>
                        <strong>{text('unreadAlerts')}</strong>
                      </span>
                    </a>
                  ) : null}
                </div>
              )}
            </section>
          ) : null}
        </>
      )}
    </section>
  );
}
