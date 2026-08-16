'use client';

import { useEffect, useState } from 'react';

type Labels = Record<string, string>;

type AlertEvent = {
  id: string;
  ruleId: string | null;
  type: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown>;
  triggeredAt: string;
  readAt: string | null;
  dismissedAt: string | null;
};

type AlertRule = {
  id: string;
  type: string;
  enabled: boolean;
  config: Record<string, unknown>;
  archivedAt: string | null;
};

type Goal = { goal: { id: string; name: string } };

function text(labels: Labels, key: string) {
  return labels[key] ?? '';
}

function eventLabel(type: string, labels: Labels) {
  switch (type) {
    case 'budget_approaching':
      return text(labels, 'budgetApproaching');
    case 'budget_exceeded':
      return text(labels, 'budgetExceeded');
    case 'reconciliation_mismatch':
      return text(labels, 'reconciliationMismatch');
    case 'uncategorized_transactions':
      return text(labels, 'uncategorized');
    case 'goal_milestone':
      return text(labels, 'goalMilestone');
    case 'goal_deadline':
      return text(labels, 'goalDeadline');
    default:
      return type;
  }
}

function eventHref(event: AlertEvent, locale: string) {
  switch (event.type) {
    case 'budget_approaching':
    case 'budget_exceeded':
      return `/${locale}/budgets`;
    case 'goal_milestone':
    case 'goal_deadline':
      return `/${locale}/goals`;
    case 'reconciliation_mismatch':
      return event.entityId ? `/${locale}/imports/${event.entityId}/summary` : `/${locale}`;
    case 'uncategorized_transactions':
      return `/${locale}/transactions?categorised=false`;
    default:
      return `/${locale}/alerts`;
  }
}

export function AlertsWorkspace({
  locale,
  advanced,
  labels,
}: {
  locale: string;
  advanced: boolean;
  labels: Labels;
}) {
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [state, setState] = useState('unread');
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [error, setError] = useState('');

  const [ruleType, setRuleType] = useState('uncategorized_transactions');
  const [threshold, setThreshold] = useState('');
  const [ruleGoalId, setRuleGoalId] = useState('');
  const [daysBefore, setDaysBefore] = useState('');
  const [milestones, setMilestones] = useState([50, 75, 100]);

  async function load() {
    const [alertsRes, rulesRes, goalsRes] = await Promise.all([
      fetch(`/api/alerts?state=${state}`, { cache: 'no-store' }),
      fetch('/api/alert-rules', { cache: 'no-store' }),
      fetch('/api/goals', { cache: 'no-store' }),
    ]);
    if (alertsRes.ok) {
      const data = await alertsRes.json();
      setEvents(data.items ?? []);
      setUnreadCount(data.unreadCount ?? 0);
    }
    if (rulesRes.ok) setRules(await rulesRes.json());
    if (goalsRes.ok) setGoals(await goalsRes.json());
  }

  useEffect(() => {
    void load();
  }, [state]);

  async function eventAction(event: AlertEvent, action: string) {
    const response = await fetch(`/api/alerts/${event.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (!response.ok) setError(text(labels, 'error'));
    else void load();
  }

  async function createRule(event: React.FormEvent) {
    event.preventDefault();
    const config =
      ruleType === 'uncategorized_transactions'
        ? { type: ruleType, threshold: Number(threshold) }
        : ruleType === 'goal_milestone'
          ? { type: ruleType, goalId: ruleGoalId, milestones }
          : { type: ruleType, goalId: ruleGoalId, daysBefore: Number(daysBefore) };
    const response = await fetch('/api/alert-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: ruleType, config }),
    });
    if (!response.ok) setError(text(labels, 'error'));
    else void load();
  }

  async function ruleAction(rule: AlertRule, action: string) {
    const response = await fetch(`/api/alert-rules/${rule.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (!response.ok) setError(text(labels, 'error'));
    else void load();
  }

  function toggleMilestone(value: number) {
    setMilestones((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );
  }

  function formatDate(value: string) {
    return new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(value));
  }

  return (
    <div className="management-workspace">
      <div className="saved-view-bar">
        <label>
          {text(labels, 'read')}
          <select value={state} onChange={(event) => setState(event.target.value)}>
            <option value="unread">{text(labels, 'unread')}</option>
            <option value="read">{text(labels, 'read')}</option>
            <option value="dismissed">{text(labels, 'dismissed')}</option>
            <option value="all">{text(labels, 'all')}</option>
          </select>
        </label>
        <p className="dashboard-muted">
          {unreadCount} {text(labels, 'unread')}
        </p>
      </div>

      <p className="form-error" role="alert">
        {error}
      </p>

      <div className="planning-list">
        {events.map((event) => (
          <div className="planning-row" key={event.id}>
            <div className="planning-row-main">
              <div className="planning-row-heading">
                <h2>{eventLabel(event.type, labels)}</h2>
                {!event.readAt && !event.dismissedAt ? (
                  <span className="planning-currency">{text(labels, 'unread')}</span>
                ) : null}
              </div>
              <p className="planning-meta">{formatDate(event.triggeredAt)}</p>
              {event.type === 'uncategorized_transactions' &&
              typeof event.metadata.count === 'number' ? (
                <>
                  <p className="planning-meta">
                    {event.metadata.count} {text(labels, 'count')}
                  </p>
                  {Array.isArray(event.metadata.amountsByCurrency) ? (
                    <p className="planning-meta">
                      {(
                        event.metadata.amountsByCurrency as Array<{
                          currency: string;
                          amount: string;
                        }>
                      )
                        .map((item) => `${item.amount} ${item.currency}`)
                        .join(' · ')}
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>
            <div className="planning-row-actions">
              <a className="text-button" href={eventHref(event, locale)}>
                {event.type === 'budget_approaching' || event.type === 'budget_exceeded'
                  ? text(labels, 'viewBudget')
                  : event.type === 'goal_milestone' || event.type === 'goal_deadline'
                    ? text(labels, 'viewGoal')
                    : event.type === 'reconciliation_mismatch'
                      ? text(labels, 'viewImport')
                      : text(labels, 'viewTransactions')}
              </a>
              <div className="row-actions">
                {!event.readAt && !event.dismissedAt ? (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => eventAction(event, 'read')}
                  >
                    {text(labels, 'markRead')}
                  </button>
                ) : null}
                {!event.dismissedAt ? (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => eventAction(event, 'dismiss')}
                  >
                    {text(labels, 'dismiss')}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ))}
        {!events.length && <p className="planning-empty">{text(labels, 'noAlerts')}</p>}
      </div>

      {advanced ? (
        <section className="dashboard-section" aria-labelledby="alert-rules-title">
          <div className="dashboard-section-heading">
            <h2 id="alert-rules-title">{text(labels, 'rulesTitle')}</h2>
          </div>
          <p className="dashboard-muted">{text(labels, 'rulesDescription')}</p>
          <form className="planning-form" onSubmit={createRule}>
            <label>
              {text(labels, 'ruleType')}
              <select value={ruleType} onChange={(event) => setRuleType(event.target.value)}>
                <option value="uncategorized_transactions">
                  {text(labels, 'ruleUncategorized')}
                </option>
                <option value="goal_milestone">{text(labels, 'ruleMilestone')}</option>
                <option value="goal_deadline">{text(labels, 'ruleDeadline')}</option>
              </select>
            </label>
            {ruleType === 'uncategorized_transactions' ? (
              <label>
                {text(labels, 'threshold')}
                <input
                  value={threshold}
                  onChange={(event) => setThreshold(event.target.value)}
                  inputMode="numeric"
                  required
                />
              </label>
            ) : (
              <label>
                {text(labels, 'goal')}
                <select
                  value={ruleGoalId}
                  onChange={(event) => setRuleGoalId(event.target.value)}
                  required
                >
                  <option value="">—</option>
                  {goals.map((goal) => (
                    <option key={goal.goal.id} value={goal.goal.id}>
                      {goal.goal.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {ruleType === 'goal_deadline' ? (
              <label>
                {text(labels, 'daysBefore')}
                <input
                  value={daysBefore}
                  onChange={(event) => setDaysBefore(event.target.value)}
                  inputMode="numeric"
                  required
                />
              </label>
            ) : null}
            {ruleType === 'goal_milestone' ? (
              <div className="planning-check">
                {[50, 75, 100].map((value) => (
                  <label key={value} className="planning-check">
                    <input
                      type="checkbox"
                      checked={milestones.includes(value)}
                      onChange={() => toggleMilestone(value)}
                    />
                    {value}%
                  </label>
                ))}
              </div>
            ) : null}
            <div className="planning-form-actions">
              <button className="primary-button" type="submit">
                {text(labels, 'createRule')}
              </button>
            </div>
          </form>

          <div className="planning-list">
            {rules.map((rule) => (
              <div className="management-row" key={rule.id}>
                <div>
                  <strong>
                    {rule.type === 'uncategorized_transactions'
                      ? text(labels, 'ruleUncategorized')
                      : rule.type === 'goal_milestone'
                        ? text(labels, 'ruleMilestone')
                        : text(labels, 'ruleDeadline')}
                  </strong>
                  <p>
                    {rule.type === 'uncategorized_transactions'
                      ? `${text(labels, 'threshold')}: ${String(rule.config.threshold ?? '')}`
                      : `${text(labels, 'goal')}: ${String(rule.config.goalId ?? '')}`}
                    {rule.enabled ? '' : ` · ${text(labels, 'disable')}`}
                    {rule.archivedAt ? ` · ${text(labels, 'archiveRule')}` : ''}
                  </p>
                </div>
                <div className="row-actions">
                  {rule.archivedAt ? (
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => ruleAction(rule, 'restore')}
                    >
                      {text(labels, 'restoreRule')}
                    </button>
                  ) : (
                    <>
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => ruleAction(rule, rule.enabled ? 'disable' : 'enable')}
                      >
                        {rule.enabled ? text(labels, 'disable') : text(labels, 'enable')}
                      </button>
                      <button
                        className="text-button danger"
                        type="button"
                        onClick={() => ruleAction(rule, 'archive')}
                      >
                        {text(labels, 'archiveRule')}
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
            {!rules.length && <p className="planning-empty">{text(labels, 'noRules')}</p>}
          </div>
        </section>
      ) : null}
    </div>
  );
}
