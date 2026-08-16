'use client';

import { useEffect, useState } from 'react';

type Labels = Record<string, string>;

type BudgetStatus = {
  budget: {
    id: string;
    name: string;
    currency: string;
    amount: string;
    periodType: string;
    categoryId: string | null;
    accountId: string | null;
    startDate: string | null;
    endDate: string | null;
    warningThreshold: number | null;
    rolloverEnabled: boolean;
    enabled: boolean;
    archivedAt: string | null;
  };
  periodStart: string;
  periodEnd: string;
  limit: string;
  spent: string;
  remaining: string;
  percentageUsed: string;
  daysRemaining: number;
  status: string;
  previousSpent: string | null;
  rolloverCarried: string;
};

type Account = { id: string; displayName: string; currencyCode: string; status: string };
type Category = { id: string; name: string; kind: string; status: string };

function text(labels: Labels, key: string) {
  return labels[key] ?? '';
}

export function BudgetsWorkspace({ advanced, labels }: { advanced: boolean; labels: Labels }) {
  const [budgets, setBudgets] = useState<BudgetStatus[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState('');

  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('');
  const [amount, setAmount] = useState('');
  const [period, setPeriod] = useState('monthly');
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [warningThreshold, setWarningThreshold] = useState('');
  const [rollover, setRollover] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function load() {
    const [budgetsRes, accountsRes, categoriesRes] = await Promise.all([
      fetch(`/api/budgets?includeArchived=${showArchived}`, { cache: 'no-store' }),
      fetch('/api/accounts', { cache: 'no-store' }),
      fetch('/api/categories', { cache: 'no-store' }),
    ]);
    if (budgetsRes.ok) setBudgets(await budgetsRes.json());
    if (accountsRes.ok) setAccounts(await accountsRes.json());
    if (categoriesRes.ok) setCategories(await categoriesRes.json());
  }

  useEffect(() => {
    void load();
  }, [showArchived]);

  function resetForm() {
    setName('');
    setCurrency('');
    setAmount('');
    setPeriod('monthly');
    setCategoryId('');
    setAccountId('');
    setStartDate('');
    setEndDate('');
    setWarningThreshold('');
    setRollover(false);
    setEditingId(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const payload = {
      name,
      currency: currency.trim().toUpperCase(),
      amount,
      period,
      categoryId: categoryId || null,
      accountId: accountId || null,
      startDate: period === 'custom' ? startDate || null : null,
      endDate: period === 'custom' ? endDate || null : null,
      warningThreshold: warningThreshold ? Number(warningThreshold) : null,
      rolloverEnabled: rollover,
    };
    const response = await fetch(editingId ? `/api/budgets/${editingId}` : '/api/budgets', {
      method: editingId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      setError(text(labels, 'error'));
      return;
    }
    setError('');
    resetForm();
    void load();
  }

  function edit(status: BudgetStatus) {
    const budget = status.budget;
    setEditingId(budget.id);
    setName(budget.name);
    setCurrency(budget.currency);
    setAmount(budget.amount);
    setPeriod(budget.periodType);
    setCategoryId(budget.categoryId ?? '');
    setAccountId(budget.accountId ?? '');
    setStartDate(budget.startDate ?? '');
    setEndDate(budget.endDate ?? '');
    setWarningThreshold(budget.warningThreshold ? String(budget.warningThreshold) : '');
    setRollover(budget.rolloverEnabled);
  }

  async function action(status: BudgetStatus, actionName: string) {
    const response = await fetch(`/api/budgets/${status.budget.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: actionName }),
    });
    if (!response.ok) setError(text(labels, 'error'));
    else void load();
  }

  const statusLabel = (status: string) => text(labels, status);

  return (
    <div className="management-workspace">
      <form className="planning-form" onSubmit={submit}>
        <label>
          {text(labels, 'name')}
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label>
          {text(labels, 'currency')}
          <input
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            maxLength={3}
            required
          />
        </label>
        <label>
          {text(labels, 'amount')}
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            required
          />
        </label>
        <label>
          {text(labels, 'period')}
          <select value={period} onChange={(event) => setPeriod(event.target.value)}>
            <option value="weekly">{text(labels, 'weekly')}</option>
            <option value="monthly">{text(labels, 'monthly')}</option>
            <option value="yearly">{text(labels, 'yearly')}</option>
            <option value="custom">{text(labels, 'custom')}</option>
          </select>
        </label>
        <label>
          {text(labels, 'category')}
          <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">{text(labels, 'allCategories')}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {text(labels, 'account')}
          <select
            value={accountId}
            onChange={(event) => {
              setAccountId(event.target.value);
              const account = accounts.find((item) => item.id === event.target.value);
              if (account) setCurrency(account.currencyCode);
            }}
          >
            <option value="">{text(labels, 'allAccounts')}</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.displayName} ({account.currencyCode})
              </option>
            ))}
          </select>
        </label>
        {period === 'custom' && (
          <>
            <label>
              {text(labels, 'startDate')}
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </label>
            <label>
              {text(labels, 'endDate')}
              <input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </label>
          </>
        )}
        {advanced && (
          <>
            <label>
              {text(labels, 'warningThreshold')}
              <input
                value={warningThreshold}
                onChange={(event) => setWarningThreshold(event.target.value)}
                inputMode="numeric"
                placeholder="80"
              />
            </label>
            <label className="planning-check">
              <input
                type="checkbox"
                checked={rollover}
                onChange={(event) => setRollover(event.target.checked)}
              />
              {text(labels, 'rollover')}
            </label>
          </>
        )}
        <div className="planning-form-actions">
          <button className="primary-button" type="submit">
            {editingId ? text(labels, 'save') : text(labels, 'create')}
          </button>
          {editingId ? (
            <button className="text-button" type="button" onClick={resetForm}>
              {text(labels, 'cancel')}
            </button>
          ) : null}
        </div>
      </form>

      <p className="form-error" role="alert">
        {error}
      </p>

      <div className="planning-list">
        {budgets.map((status) => {
          const budget = status.budget;
          const remainingNegative = status.remaining.startsWith('-');
          const fillClass =
            status.status === 'exceeded'
              ? 'planning-exceeded'
              : status.status === 'approaching'
                ? 'planning-approaching'
                : '';
          return (
            <div className="planning-row" key={budget.id}>
              <div className="planning-row-main">
                <div className="planning-row-heading">
                  <h2>{budget.name}</h2>
                  <span className="planning-currency">{budget.currency}</span>
                  {!budget.enabled || budget.archivedAt ? (
                    <span className="planning-currency">
                      {budget.archivedAt ? text(labels, 'archive') : text(labels, 'disable')}
                    </span>
                  ) : null}
                </div>
                <p className="planning-amount">
                  {status.spent} <small>/ {status.limit}</small>
                </p>
                <p className="planning-meta">
                  {status.percentageUsed}% {text(labels, 'used')} ·{' '}
                  {remainingNegative
                    ? `${status.remaining.slice(1)} ${text(labels, 'exceeded')}`
                    : `${status.remaining} ${text(labels, 'remaining')}`}
                </p>
                <div className="planning-progress" role="img" aria-hidden="true">
                  <span
                    className={`planning-progress-fill ${fillClass}`}
                    style={{ width: `${Math.min(100, Number(status.percentageUsed))}%` }}
                  />
                </div>
                <p
                  className={`planning-status ${status.status === 'exceeded' ? 'planning-exceeded' : status.status === 'approaching' ? 'planning-approaching' : 'planning-healthy'}`}
                >
                  {statusLabel(status.status)} · {status.daysRemaining}{' '}
                  {text(labels, 'daysRemaining')}
                </p>
                {advanced && (
                  <details className="planning-advanced">
                    <summary>{text(labels, 'periodRange')}</summary>
                    <p>
                      {status.periodStart} – {status.periodEnd}
                      {status.previousSpent !== null
                        ? ` · ${text(labels, 'previousSpent')}: ${status.previousSpent}`
                        : ''}
                      {status.rolloverCarried !== '0'
                        ? ` · ${text(labels, 'rolloverCarried')}: ${status.rolloverCarried}`
                        : ''}
                    </p>
                  </details>
                )}
              </div>
              <div className="planning-row-actions">
                <div className="row-actions">
                  <button className="text-button" type="button" onClick={() => edit(status)}>
                    {text(labels, 'edit')}
                  </button>
                  {budget.archivedAt ? (
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => action(status, 'restore')}
                    >
                      {text(labels, 'restore')}
                    </button>
                  ) : (
                    <>
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => action(status, budget.enabled ? 'disable' : 'enable')}
                      >
                        {budget.enabled ? text(labels, 'disable') : text(labels, 'enable')}
                      </button>
                      <button
                        className="text-button danger"
                        type="button"
                        onClick={() => action(status, 'archive')}
                      >
                        {text(labels, 'archive')}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {!budgets.length && <p className="planning-empty">{text(labels, 'empty')}</p>}
      </div>

      <div className="bulk-actions">
        <button
          className="text-button"
          type="button"
          onClick={() => setShowArchived((value) => !value)}
        >
          {showArchived ? text(labels, 'hideArchived') : text(labels, 'showArchived')}
        </button>
      </div>
    </div>
  );
}
