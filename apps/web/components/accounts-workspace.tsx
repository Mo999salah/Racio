'use client';

import { useState } from 'react';

type Institution = { id: string; name: string; countryCode: string };
type Account = {
  id: string;
  institutionName: string;
  displayName: string;
  accountType: 'checking' | 'savings' | 'credit' | 'cash' | 'other';
  currencyCode: string;
  maskedAccountIdentifier: string | null;
  maskedIban: string | null;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
};

const currencies = ['AED', 'CAD', 'CHF', 'EGP', 'EUR', 'GBP', 'JPY', 'SAR', 'TRY', 'USD'];
const accountTypes = ['checking', 'savings', 'credit', 'cash', 'other'] as const;

export function resolveDateLocale(localeValue: string, doc = globalThis.document) {
  const candidates = [localeValue, doc?.documentElement?.lang, 'en'];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;

    const normalized = candidate.trim();
    if (!normalized) continue;

    try {
      return Intl.getCanonicalLocales(normalized)[0];
    } catch {
      // Try the next locale candidate.
    }
  }

  return 'en';
}

export function AccountsWorkspace({
  initialInstitutions,
  initialAccounts,
  locale,
  advanced,
  labels,
}: {
  initialInstitutions: Institution[];
  initialAccounts: Account[];
  locale: string;
  advanced: boolean;
  labels: Record<string, string>;
}) {
  const [institutions, setInstitutions] = useState(initialInstitutions);
  const [accounts, setAccounts] = useState(initialAccounts);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [institutionName, setInstitutionName] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [institutionId, setInstitutionId] = useState(initialInstitutions[0]?.id ?? '');
  const [displayName, setDisplayName] = useState('');
  const [accountType, setAccountType] = useState<(typeof accountTypes)[number]>('checking');
  const [currencyCode, setCurrencyCode] = useState('');
  const [maskedAccountIdentifier, setMaskedAccountIdentifier] = useState('');
  const [maskedIban, setMaskedIban] = useState('');
  const [editing, setEditing] = useState<Account | null>(null);

  const getLabel = (key: string) => labels[key] ?? labels.error ?? '';

  function clearNotice() {
    setMessage('');
    setError('');
  }

  async function readError(response: Response) {
    const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
    if (body?.error?.code === 'CONFLICT') return getLabel('conflictAccount');
    return getLabel('error');
  }

  async function refresh(nextShowArchived = showArchived) {
    const [institutionsResponse, accountsResponse] = await Promise.all([
      fetch('/api/institutions', { cache: 'no-store' }),
      fetch(`/api/accounts?includeArchived=${nextShowArchived}`, { cache: 'no-store' }),
    ]);
    if (!institutionsResponse.ok || !accountsResponse.ok) throw new Error(getLabel('error'));
    const nextInstitutions = (await institutionsResponse.json()) as Institution[];
    const nextAccounts = (await accountsResponse.json()) as Account[];
    setInstitutions(nextInstitutions);
    setAccounts(nextAccounts);
    if (!institutionId && nextInstitutions[0]) setInstitutionId(nextInstitutions[0].id);
  }

  async function saveInstitution(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearNotice();
    setBusy(true);
    const response = await fetch('/api/institutions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: institutionName, countryCode: countryCode.toUpperCase() }),
    });
    if (response.ok) {
      const created = (await response.json()) as Institution;
      setInstitutionName('');
      setCountryCode('');
      setInstitutionId(created.id);
      await refresh();
      setMessage(getLabel('success'));
    } else {
      const body = (await response.json().catch(() => null)) as {
        error?: { code?: string };
      } | null;
      setError(
        body?.error?.code === 'CONFLICT' ? getLabel('conflictInstitution') : getLabel('error'),
      );
    }
    setBusy(false);
  }

  async function saveAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearNotice();
    setBusy(true);
    const response = await fetch('/api/accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        institutionId,
        displayName,
        accountType,
        currencyCode,
        maskedAccountIdentifier: maskedAccountIdentifier || null,
        maskedIban: maskedIban || null,
      }),
    });
    if (response.ok) {
      setDisplayName('');
      setCurrencyCode('');
      setMaskedAccountIdentifier('');
      setMaskedIban('');
      await refresh();
      setMessage(getLabel('success'));
    } else {
      setError(await readError(response));
    }
    setBusy(false);
  }

  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    clearNotice();
    setBusy(true);
    const response = await fetch(`/api/accounts/${editing.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        displayName: editing.displayName,
        accountType: editing.accountType,
        currencyCode: editing.currencyCode,
        maskedAccountIdentifier: editing.maskedAccountIdentifier,
        maskedIban: editing.maskedIban,
      }),
    });
    if (response.ok) {
      setEditing(null);
      await refresh();
      setMessage(getLabel('success'));
    } else {
      setError(await readError(response));
    }
    setBusy(false);
  }

  async function changeArchive(account: Account) {
    const confirmed = window.confirm(
      account.status === 'active' ? getLabel('archiveConfirm') : getLabel('restoreConfirm'),
    );
    if (!confirmed) return;
    clearNotice();
    setBusy(true);
    const action = account.status === 'active' ? 'archive' : 'restore';
    const response = await fetch(`/api/accounts/${account.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (response.ok) {
      await refresh();
      setMessage(getLabel('success'));
    } else {
      setError(getLabel('error'));
    }
    setBusy(false);
  }

  function formatDate(value: string) {
    return new Intl.DateTimeFormat(resolveDateLocale(locale), { dateStyle: 'medium' }).format(
      new Date(value),
    );
  }

  return (
    <div className="accounts-workspace">
      <div className="accounts-notice" aria-live="polite">
        {message ? <p className="form-success">{message}</p> : null}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className="accounts-forms">
        <section className="account-form-panel" aria-labelledby="institution-form-title">
          <p className="panel-kicker" id="institution-form-title">
            {labels.addInstitution}
          </p>
          <form className="account-form" onSubmit={saveInstitution}>
            <label>
              {labels.institutionName} <span className="required-mark">({labels.required})</span>
              <input
                required
                maxLength={160}
                value={institutionName}
                onChange={(event) => setInstitutionName(event.target.value)}
              />
            </label>
            <label>
              {labels.country} <span className="required-mark">({labels.required})</span>
              <input
                required
                maxLength={2}
                value={countryCode}
                onChange={(event) => setCountryCode(event.target.value.toUpperCase())}
              />
              <small>{labels.countryHint}</small>
            </label>
            <button className="primary-button" type="submit" disabled={busy}>
              {labels.saveInstitution}
            </button>
          </form>
        </section>
        <section className="account-form-panel" aria-labelledby="account-form-title">
          <p className="panel-kicker" id="account-form-title">
            {labels.addAccount}
          </p>
          {institutions.length ? (
            <form className="account-form" onSubmit={saveAccount}>
              <label>
                {labels.institution} <span className="required-mark">({labels.required})</span>
                <select
                  required
                  value={institutionId}
                  onChange={(event) => setInstitutionId(event.target.value)}
                >
                  <option value="">{labels.selectInstitution}</option>
                  {institutions.map((institution) => (
                    <option key={institution.id} value={institution.id}>
                      {institution.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {labels.accountDisplayName}{' '}
                <span className="required-mark">({labels.required})</span>
                <input
                  required
                  maxLength={160}
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>
              <label>
                {labels.accountType} <span className="required-mark">({labels.required})</span>
                <select
                  value={accountType}
                  onChange={(event) =>
                    setAccountType(event.target.value as (typeof accountTypes)[number])
                  }
                >
                  {accountTypes.map((type) => (
                    <option key={type} value={type}>
                      {getLabel(type)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {labels.currency} <span className="required-mark">({labels.required})</span>
                <select
                  required
                  value={currencyCode}
                  onChange={(event) => setCurrencyCode(event.target.value)}
                >
                  <option value="">{labels.currency}</option>
                  {currencies.map((currency) => (
                    <option key={currency} value={currency}>
                      {currency}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {labels.maskedIdentifier}
                <input
                  maxLength={80}
                  value={maskedAccountIdentifier}
                  onChange={(event) => setMaskedAccountIdentifier(event.target.value)}
                />
              </label>
              <label>
                {labels.maskedIban}
                <input
                  maxLength={80}
                  value={maskedIban}
                  onChange={(event) => setMaskedIban(event.target.value)}
                />
                <small>{labels.maskedHint}</small>
              </label>
              <button className="primary-button" type="submit" disabled={busy}>
                {labels.saveAccount}
              </button>
            </form>
          ) : (
            <p className="empty-note">{labels.emptyInstitutions}</p>
          )}
        </section>
      </div>
      <section className="accounts-list-section" aria-labelledby="accounts-list-title">
        <div className="accounts-list-heading">
          <div>
            <p className="panel-kicker">{labels.accountsList}</p>
            <h2 id="accounts-list-title">{showArchived ? labels.showArchived : labels.active}</h2>
          </div>
          <button
            className="text-button"
            type="button"
            onClick={async () => {
              const next = !showArchived;
              setShowArchived(next);
              await refresh(next);
            }}
          >
            {showArchived ? labels.hideArchived : labels.showArchived}
          </button>
        </div>
        {accounts.length ? (
          <div className="account-records">
            {accounts.map((account) => (
              <article className="account-record" key={account.id}>
                <div className="account-record-main">
                  <p className="account-record-institution">{account.institutionName}</p>
                  <h3>{account.displayName}</h3>
                  <p className="account-record-meta">
                    {getLabel(account.accountType)} · {account.currencyCode}
                  </p>
                  {account.maskedAccountIdentifier ? (
                    <p className="account-identifier">{account.maskedAccountIdentifier}</p>
                  ) : null}
                  {account.maskedIban ? (
                    <p className="account-identifier">{account.maskedIban}</p>
                  ) : null}
                </div>
                <div className="account-record-actions">
                  <span
                    className={
                      account.status === 'active'
                        ? 'status-text'
                        : 'status-text status-text-archived'
                    }
                  >
                    {account.status === 'active' ? labels.active : labels.archived}
                  </span>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => setEditing({ ...account })}
                  >
                    {labels.edit}
                  </button>
                  <button
                    className="text-button danger"
                    type="button"
                    disabled={busy}
                    onClick={() => changeArchive(account)}
                  >
                    {account.status === 'active' ? labels.archive : labels.restore}
                  </button>
                  {account.status === 'active' ? (
                    <a
                      className="text-button"
                      href={`/${locale}/imports/new?accountId=${encodeURIComponent(account.id)}`}
                    >
                      {labels.importCsv}
                    </a>
                  ) : null}
                </div>
                {advanced ? (
                  <details className="account-advanced">
                    <summary>{labels.advancedDetails}</summary>
                    <p>
                      {labels.created}: {formatDate(account.createdAt)}
                    </p>
                    <p>
                      {labels.updated}: {formatDate(account.updatedAt)}
                    </p>
                  </details>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-note">{labels.emptyAccounts}</p>
        )}
      </section>
      {editing ? (
        <section className="account-edit-panel" aria-labelledby="account-edit-title">
          <div className="accounts-list-heading">
            <h2 id="account-edit-title">
              {labels.edit}: {editing.displayName}
            </h2>
            <button className="text-button" type="button" onClick={() => setEditing(null)}>
              {labels.cancel}
            </button>
          </div>
          <form className="account-form account-edit-form" onSubmit={saveEdit}>
            <label>
              {labels.accountDisplayName}
              <input
                required
                maxLength={160}
                value={editing.displayName}
                onChange={(event) => setEditing({ ...editing, displayName: event.target.value })}
              />
            </label>
            <label>
              {labels.accountType}
              <select
                value={editing.accountType}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    accountType: event.target.value as Account['accountType'],
                  })
                }
              >
                {accountTypes.map((type) => (
                  <option key={type} value={type}>
                    {getLabel(type)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {labels.currency}
              <select
                value={editing.currencyCode}
                onChange={(event) => setEditing({ ...editing, currencyCode: event.target.value })}
              >
                {currencies.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {labels.maskedIdentifier}
              <input
                maxLength={80}
                value={editing.maskedAccountIdentifier ?? ''}
                onChange={(event) =>
                  setEditing({ ...editing, maskedAccountIdentifier: event.target.value || null })
                }
              />
            </label>
            <label>
              {labels.maskedIban}
              <input
                maxLength={80}
                value={editing.maskedIban ?? ''}
                onChange={(event) =>
                  setEditing({ ...editing, maskedIban: event.target.value || null })
                }
              />
            </label>
            <button className="primary-button" type="submit" disabled={busy}>
              {labels.saveChanges}
            </button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
