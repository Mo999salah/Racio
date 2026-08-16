'use client';

import { useEffect, useState } from 'react';

type Labels = Record<string, string>;

type GoalProgress = {
  goal: {
    id: string;
    name: string;
    currency: string;
    targetAmount: string;
    targetDate: string | null;
    trackingMode: string;
    accountId: string | null;
    manualSavedAmount: string | null;
    enabled: boolean;
    archivedAt: string | null;
  };
  currentAmount: string | null;
  remaining: string | null;
  percentageComplete: string | null;
  daysRemaining: number | null;
  balanceAvailable: boolean;
  balanceAsOf: string | null;
  source: string;
};

type Account = { id: string; displayName: string; currencyCode: string; status: string };

function text(labels: Labels, key: string) {
  return labels[key] ?? '';
}

export function GoalsWorkspace({ advanced, labels }: { advanced: boolean; labels: Labels }) {
  const [goals, setGoals] = useState<GoalProgress[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState('');

  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [trackingMode, setTrackingMode] = useState('manual');
  const [accountId, setAccountId] = useState('');
  const [manualSavedAmount, setManualSavedAmount] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [progressGoalId, setProgressGoalId] = useState<string | null>(null);
  const [progressAmount, setProgressAmount] = useState('');

  async function load() {
    const [goalsRes, accountsRes] = await Promise.all([
      fetch(`/api/goals?includeArchived=${showArchived}`, { cache: 'no-store' }),
      fetch('/api/accounts', { cache: 'no-store' }),
    ]);
    if (goalsRes.ok) setGoals(await goalsRes.json());
    if (accountsRes.ok) setAccounts(await accountsRes.json());
  }

  useEffect(() => {
    void load();
  }, [showArchived]);

  function resetForm() {
    setName('');
    setCurrency('');
    setTargetAmount('');
    setTargetDate('');
    setTrackingMode('manual');
    setAccountId('');
    setManualSavedAmount('');
    setEditingId(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const payload = {
      name,
      currency: currency.trim().toUpperCase(),
      targetAmount,
      targetDate: targetDate || null,
      trackingMode,
      accountId: trackingMode === 'account_balance' ? accountId || null : null,
      manualSavedAmount: trackingMode === 'manual' ? manualSavedAmount || '0' : null,
    };
    const response = await fetch(editingId ? `/api/goals/${editingId}` : '/api/goals', {
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

  function edit(progress: GoalProgress) {
    const goal = progress.goal;
    setEditingId(goal.id);
    setName(goal.name);
    setCurrency(goal.currency);
    setTargetAmount(goal.targetAmount);
    setTargetDate(goal.targetDate ?? '');
    setTrackingMode(goal.trackingMode);
    setAccountId(goal.accountId ?? '');
    setManualSavedAmount(goal.manualSavedAmount ?? '');
  }

  async function action(progress: GoalProgress, actionName: string) {
    const response = await fetch(`/api/goals/${progress.goal.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: actionName }),
    });
    if (!response.ok) setError(text(labels, 'error'));
    else void load();
  }

  async function updateProgress(progress: GoalProgress) {
    const response = await fetch(`/api/goals/${progress.goal.id}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manualSavedAmount: progressAmount }),
    });
    if (!response.ok) setError(text(labels, 'error'));
    else {
      setProgressGoalId(null);
      setProgressAmount('');
      void load();
    }
  }

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
          {text(labels, 'targetAmount')}
          <input
            value={targetAmount}
            onChange={(event) => setTargetAmount(event.target.value)}
            inputMode="decimal"
            required
          />
        </label>
        <label>
          {text(labels, 'targetDate')}
          <input
            type="date"
            value={targetDate}
            onChange={(event) => setTargetDate(event.target.value)}
          />
        </label>
        <label>
          {text(labels, 'trackingMode')}
          <select value={trackingMode} onChange={(event) => setTrackingMode(event.target.value)}>
            <option value="manual">{text(labels, 'manual')}</option>
            <option value="account_balance">{text(labels, 'accountBalance')}</option>
          </select>
        </label>
        {trackingMode === 'account_balance' ? (
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
              <option value="">—</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.displayName} ({account.currencyCode})
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label>
            {text(labels, 'manualSavedAmount')}
            <input
              value={manualSavedAmount}
              onChange={(event) => setManualSavedAmount(event.target.value)}
              inputMode="decimal"
              placeholder="0"
            />
          </label>
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
        {goals.map((progress) => {
          const goal = progress.goal;
          const unavailable = !progress.balanceAvailable || progress.currentAmount === null;
          const remainingNegative =
            progress.remaining !== null && progress.remaining.startsWith('-');
          const fillWidth =
            progress.percentageComplete === null
              ? 0
              : Math.min(100, Number(progress.percentageComplete));
          return (
            <div className="planning-row" key={goal.id}>
              <div className="planning-row-main">
                <div className="planning-row-heading">
                  <h2>{goal.name}</h2>
                  <span className="planning-currency">{goal.currency}</span>
                  {goal.archivedAt ? (
                    <span className="planning-currency">{text(labels, 'archive')}</span>
                  ) : null}
                </div>
                <p className="planning-amount">
                  {unavailable ? '—' : progress.currentAmount} <small>/ {goal.targetAmount}</small>
                </p>
                <p className="planning-meta">
                  {unavailable
                    ? text(labels, 'balanceUnavailable')
                    : `${progress.percentageComplete}% ${text(labels, 'complete')} · ${
                        remainingNegative
                          ? `${progress.remaining!.slice(1)} ${text(labels, 'exceeded')}`
                          : `${progress.remaining} ${text(labels, 'remaining')}`
                      }`}
                </p>
                <div className="planning-progress" role="img" aria-hidden="true">
                  <span className="planning-progress-fill" style={{ width: `${fillWidth}%` }} />
                </div>
                <p className="planning-meta">
                  {goal.targetDate
                    ? `${text(labels, 'targetDate')}: ${goal.targetDate} · ${
                        progress.daysRemaining
                      } ${text(labels, 'daysRemaining')}`
                    : ''}
                  {advanced && goal.trackingMode === 'account_balance'
                    ? ` · ${text(labels, 'balanceAsOf')}: ${progress.balanceAsOf ?? '—'}`
                    : ''}
                </p>
              </div>
              <div className="planning-row-actions">
                <div className="row-actions">
                  {goal.trackingMode === 'manual' && (
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => {
                        setProgressGoalId(goal.id);
                        setProgressAmount(progress.currentAmount ?? '0');
                      }}
                    >
                      {text(labels, 'updateProgress')}
                    </button>
                  )}
                  <button className="text-button" type="button" onClick={() => edit(progress)}>
                    {text(labels, 'edit')}
                  </button>
                  {goal.archivedAt ? (
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => action(progress, 'restore')}
                    >
                      {text(labels, 'restore')}
                    </button>
                  ) : (
                    <button
                      className="text-button danger"
                      type="button"
                      onClick={() => action(progress, 'archive')}
                    >
                      {text(labels, 'archive')}
                    </button>
                  )}
                </div>
                {progressGoalId === goal.id ? (
                  <form
                    className="management-inline"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void updateProgress(progress);
                    }}
                  >
                    <label>
                      {text(labels, 'manualSavedAmount')}
                      <input
                        value={progressAmount}
                        onChange={(event) => setProgressAmount(event.target.value)}
                        inputMode="decimal"
                      />
                    </label>
                    <button className="primary-button" type="submit">
                      {text(labels, 'save')}
                    </button>
                  </form>
                ) : null}
              </div>
            </div>
          );
        })}
        {!goals.length && <p className="planning-empty">{text(labels, 'empty')}</p>}
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
