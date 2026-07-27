'use client';

import { useEffect, useState } from 'react';

type Labels = Record<string, string>;
type Category = { id: string; name: string; status: string };
type Tag = { id: string; name: string; archivedAt?: string | null };
type Account = { id: string; displayName: string };
type Institution = { id: string; name: string };
type ConditionField =
  | 'account'
  | 'institution'
  | 'direction'
  | 'currency'
  | 'description'
  | 'counterparty'
  | 'amount'
  | 'booking_day'
  | 'existing_tag'
  | 'uncategorised_only'
  | 'statement_source_type';
type Condition = { field: ConditionField; operator: string; value: string };
type Action =
  | { type: 'primary_category'; categoryId: string }
  | { type: 'secondary_category'; categoryId: string }
  | { type: 'add_tag'; tagId: string }
  | { type: 'mark_reviewed' };
type Rule = {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  applyScope: 'future_only' | 'historical_and_future';
  matchMode: 'all' | 'any';
  archivedAt: string | null;
  conditions: { version: 1; items: Condition[] };
  actions: { version: 1; items: Action[] };
};
type Preview = {
  count: number;
  sample: Array<{
    id: string;
    bookingDate: string;
    amount: string;
    currencyCode: string;
    description: string;
    accountName: string;
    reviewed: boolean;
  }>;
  conflicts: Preview['sample'];
  skipped: Preview['sample'];
  dateRange: { from: string | null; to: string | null };
  accounts: string[];
  actions: {
    primaryCategoryId: string | null;
    secondaryCategoryIds: string[];
    tagIds: string[];
    markReviewed: boolean;
  };
  manualProtectedCount: number;
  historicalLimit: number;
  applyScope: string;
  previewHash: string;
  truncated: boolean;
};
type Event = {
  id: string;
  transactionId: string;
  appliedAt: string;
  revertedAt: string | null;
  reason: string;
};

const fields: Array<{ value: ConditionField; label: string; operators: string[] }> = [
  { value: 'description', label: 'Description', operators: ['contains', 'starts_with', 'equals'] },
  {
    value: 'counterparty',
    label: 'Counterparty',
    operators: ['contains', 'starts_with', 'equals'],
  },
  { value: 'amount', label: 'Amount', operators: ['equals', 'minimum', 'maximum'] },
  { value: 'currency', label: 'Currency', operators: ['equals'] },
  { value: 'direction', label: 'Direction', operators: ['equals'] },
  { value: 'account', label: 'Account', operators: ['equals'] },
  { value: 'institution', label: 'Institution', operators: ['equals'] },
  { value: 'existing_tag', label: 'Existing tag', operators: ['equals'] },
  { value: 'booking_day', label: 'Booking day', operators: ['equals'] },
  { value: 'uncategorised_only', label: 'Uncategorised only', operators: ['equals'] },
  { value: 'statement_source_type', label: 'Statement source type', operators: ['equals'] },
];

function blankCondition(): Condition {
  return { field: 'description', operator: 'contains', value: '' };
}

function blankAction(): Action {
  return { type: 'primary_category', categoryId: '' };
}

function emptyRule(): Omit<Rule, 'id' | 'archivedAt'> {
  return {
    name: '',
    enabled: true,
    priority: 100,
    applyScope: 'future_only',
    matchMode: 'all',
    conditions: { version: 1, items: [blankCondition()] },
    actions: { version: 1, items: [blankAction()] },
  };
}

function validateBuilder(rule: ReturnType<typeof emptyRule>, labels: Labels) {
  if (!rule.name.trim()) return labels.nameRequired ?? 'A rule name is required.';
  return '';
}

export function RulesWorkspace({
  labels,
  advanced,
  initialTransactionId,
}: {
  labels: Labels;
  advanced: boolean;
  initialTransactionId?: string;
}) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [builder, setBuilder] = useState(emptyRule());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Record<string, Preview>>({});
  const [history, setHistory] = useState<Event[] | null>(null);
  const [historyRuleId, setHistoryRuleId] = useState('');
  const [historicalRuleId, setHistoricalRuleId] = useState('');
  const [historicalConfirmed, setHistoricalConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    const [
      rulesResponse,
      categoriesResponse,
      tagsResponse,
      accountsResponse,
      institutionsResponse,
    ] = await Promise.all([
      fetch(`/api/rules?includeArchived=${showArchived}`, { cache: 'no-store' }),
      fetch('/api/categories', { cache: 'no-store' }),
      fetch('/api/tags', { cache: 'no-store' }),
      fetch('/api/accounts', { cache: 'no-store' }),
      fetch('/api/institutions', { cache: 'no-store' }),
    ]);
    if (rulesResponse.ok) setRules(await rulesResponse.json());
    if (categoriesResponse.ok) setCategories(await categoriesResponse.json());
    if (tagsResponse.ok) setTags(await tagsResponse.json());
    if (accountsResponse.ok) setAccounts(await accountsResponse.json());
    if (institutionsResponse.ok) setInstitutions(await institutionsResponse.json());
  }

  useEffect(() => {
    void load();
  }, [showArchived]);

  useEffect(() => {
    if (!initialTransactionId) return;
    void (async () => {
      const response = await fetch(`/api/transactions/${initialTransactionId}`, {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const transaction = await response.json();
      setBuilder((current) => ({
        ...current,
        conditions: {
          version: 1,
          items: [
            { field: 'description', operator: 'contains', value: transaction.importedDescription },
            { field: 'currency', operator: 'equals', value: transaction.currencyCode },
            { field: 'account', operator: 'equals', value: transaction.financialAccountId },
          ],
        },
        actions: transaction.primaryCategory
          ? {
              version: 1,
              items: [{ type: 'primary_category', categoryId: transaction.primaryCategory.id }],
            }
          : current.actions,
      }));
    })();
  }, [initialTransactionId]);

  function updateBuilder<K extends keyof ReturnType<typeof emptyRule>>(
    key: K,
    value: ReturnType<typeof emptyRule>[K],
  ) {
    setBuilder((current) => ({ ...current, [key]: value }));
    setError('');
    if (editingId)
      setPreview((current) => {
        const next = { ...current };
        delete next[editingId];
        return next;
      });
  }

  function updateCondition(index: number, patch: Partial<Condition>) {
    setBuilder((current) => {
      const items = current.conditions.items.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              ...patch,
              ...(patch.field
                ? {
                    operator:
                      fields.find((field) => field.value === patch.field)?.operators[0] ?? 'equals',
                  }
                : {}),
            }
          : item,
      );
      return { ...current, conditions: { version: 1, items } };
    });
    setError('');
  }

  function updateAction(index: number, patch: Partial<Action>) {
    setBuilder((current) => ({
      ...current,
      actions: {
        version: 1,
        items: current.actions.items.map((item, itemIndex) =>
          itemIndex === index ? ({ ...item, ...patch } as Action) : item,
        ),
      },
    }));
    setError('');
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const validation = validateBuilder(builder, labels);
    if (validation) return setError(validation);
    const response = await fetch(editingId ? `/api/rules/${editingId}` : '/api/rules', {
      method: editingId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(builder),
    });
    if (!response.ok) return setError(labels.error ?? 'Save failed');
    setNotice(labels.saved ?? 'Saved');
    setError('');
    setEditingId(null);
    setBuilder(emptyRule());
    void load();
  }

  function edit(rule: Rule) {
    setEditingId(rule.id);
    setBuilder({
      name: rule.name,
      enabled: rule.enabled,
      priority: rule.priority,
      applyScope: rule.applyScope,
      matchMode: rule.matchMode,
      conditions: rule.conditions,
      actions: rule.actions,
    });
    setError('');
  }

  async function action(rule: Rule, actionName: 'enable' | 'disable' | 'archive' | 'restore') {
    const response = await fetch(`/api/rules/${rule.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: actionName }),
    });
    if (!response.ok) return setError(labels.error ?? 'Update failed');
    void load();
  }

  async function previewRule(rule: Rule) {
    const response = await fetch(`/api/rules/${rule.id}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!response.ok) return setError(labels.error ?? 'Preview failed');
    const data = (await response.json()) as Preview;
    setPreview((current) => ({ ...current, [rule.id]: data }));
  }

  async function applyHistorical() {
    const current = preview[historicalRuleId];
    if (!current || !historicalConfirmed) return;
    const response = await fetch(`/api/rules/${historicalRuleId}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true, previewHash: current.previewHash }),
    });
    if (!response.ok) {
      setError(labels.stalePreview ?? 'The preview is stale or no longer eligible. Preview again.');
      return;
    }
    setHistoricalRuleId('');
    setHistoricalConfirmed(false);
    setNotice(labels.saved ?? 'Saved');
    void load();
  }

  async function loadHistory(ruleId: string) {
    const response = await fetch(`/api/rules/${ruleId}/events`, { cache: 'no-store' });
    if (!response.ok) return setError(labels.error ?? 'History failed');
    setHistoryRuleId(ruleId);
    setHistory(await response.json());
  }

  async function revert(event: Event) {
    if (!window.confirm(labels.confirmRevert ?? 'Revert this rule application?')) return;
    const response = await fetch(`/api/rules/events/${event.id}/revert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    });
    if (!response.ok) return setError(labels.error ?? 'Revert failed');
    void loadHistory(historyRuleId);
  }

  function conditionValue(condition: Condition, index: number) {
    if (condition.field === 'account')
      return (
        <select
          aria-label={`${labels.condition ?? 'Condition'} ${index + 1}`}
          value={condition.value}
          onChange={(event) => updateCondition(index, { value: event.target.value })}
        >
          <option value="">{labels.chooseAccount ?? 'Choose account'}</option>
          {accounts.map((item) => (
            <option key={item.id} value={item.id}>
              {item.displayName}
            </option>
          ))}
        </select>
      );
    if (condition.field === 'institution')
      return (
        <select
          aria-label={`${labels.condition ?? 'Condition'} ${index + 1}`}
          value={condition.value}
          onChange={(event) => updateCondition(index, { value: event.target.value })}
        >
          <option value="">{labels.chooseInstitution ?? 'Choose institution'}</option>
          {institutions.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      );
    if (condition.field === 'existing_tag')
      return (
        <select
          aria-label={`${labels.condition ?? 'Condition'} ${index + 1}`}
          value={condition.value}
          onChange={(event) => updateCondition(index, { value: event.target.value })}
        >
          <option value="">{labels.chooseTag ?? 'Choose tag'}</option>
          {tags
            .filter((item) => !item.archivedAt)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
        </select>
      );
    if (condition.field === 'direction')
      return (
        <select
          aria-label={`${labels.condition ?? 'Condition'} ${index + 1}`}
          value={condition.value}
          onChange={(event) => updateCondition(index, { value: event.target.value })}
        >
          <option value="">{labels.chooseDirection ?? 'Choose direction'}</option>
          <option value="debit">{labels.debit ?? 'Debit'}</option>
          <option value="credit">{labels.credit ?? 'Credit'}</option>
          <option value="unknown">{labels.unknown ?? 'Unknown'}</option>
        </select>
      );
    if (condition.field === 'uncategorised_only')
      return (
        <select
          aria-label={`${labels.condition ?? 'Condition'} ${index + 1}`}
          value={condition.value}
          onChange={(event) => updateCondition(index, { value: event.target.value })}
        >
          <option value="true">{labels.yes ?? 'Yes'}</option>
          <option value="false">{labels.no ?? 'No'}</option>
        </select>
      );
    return (
      <input
        aria-label={`${labels.condition ?? 'Condition'} ${index + 1} value`}
        inputMode={condition.field === 'amount' ? 'decimal' : undefined}
        value={condition.value}
        onChange={(event) => updateCondition(index, { value: event.target.value })}
      />
    );
  }

  return (
    <div className="management-workspace">
      <form className="rule-builder" onSubmit={save}>
        <div className="rule-builder-heading">
          <div>
            <h2>
              {editingId ? (labels.editRule ?? 'Edit rule') : (labels.createRule ?? 'Create rule')}
            </h2>
            <p>
              {labels.builderHint ??
                'Build a deterministic rule. Imported financial facts are never changed.'}
            </p>
          </div>
          <button
            className="text-button"
            type="button"
            onClick={() => {
              setEditingId(null);
              setBuilder(emptyRule());
            }}
          >
            {labels.newRule ?? 'New rule'}
          </button>
        </div>
        <div className="rule-meta-grid">
          <label>
            {labels.name}
            <input
              value={builder.name}
              onChange={(event) => updateBuilder('name', event.target.value)}
              required
            />
          </label>
          {advanced && (
            <label>
              {labels.priority ?? 'Priority'}
              <input
                type="number"
                value={builder.priority}
                onChange={(event) =>
                  updateBuilder('priority', Number.parseInt(event.target.value || '0', 10))
                }
              />
            </label>
          )}
          <label>
            {labels.scope ?? 'Scope'}
            <select
              value={builder.applyScope}
              onChange={(event) =>
                updateBuilder('applyScope', event.target.value as Rule['applyScope'])
              }
            >
              <option value="future_only">{labels.futureOnly}</option>
              <option value="historical_and_future">{labels.historicalAndFuture}</option>
            </select>
          </label>
          {advanced && (
            <label>
              {labels.matchMode ?? 'Match mode'}
              <select
                value={builder.matchMode}
                onChange={(event) =>
                  updateBuilder('matchMode', event.target.value as Rule['matchMode'])
                }
              >
                <option value="all">{labels.allConditions ?? 'All conditions'}</option>
                <option value="any">{labels.anyCondition ?? 'Any condition'}</option>
              </select>
            </label>
          )}
          <label className="check-row">
            <input
              type="checkbox"
              checked={builder.enabled}
              onChange={(event) => updateBuilder('enabled', event.target.checked)}
            />
            {labels.enabled}
          </label>
        </div>
        <fieldset className="rule-section">
          <legend>{labels.conditions ?? 'Conditions'}</legend>
          {builder.conditions.items.map((condition, index) => (
            <div className="rule-line" key={`${index}-${condition.field}`}>
              <select
                aria-label={`${labels.field ?? 'Field'} ${index + 1}`}
                value={condition.field}
                onChange={(event) =>
                  updateCondition(index, { field: event.target.value as ConditionField })
                }
              >
                {fields.map((field) => (
                  <option key={field.value} value={field.value}>
                    {labels[field.value] ?? field.label}
                  </option>
                ))}
              </select>
              <select
                aria-label={`${labels.operator ?? 'Operator'} ${index + 1}`}
                value={condition.operator}
                onChange={(event) => updateCondition(index, { operator: event.target.value })}
              >
                {(
                  fields.find((field) => field.value === condition.field)?.operators ?? ['equals']
                ).map((operator) => (
                  <option key={operator} value={operator}>
                    {labels[operator] ?? operator}
                  </option>
                ))}
              </select>
              {conditionValue(condition, index)}
              <button
                className="text-button"
                type="button"
                aria-label={`${labels.removeCondition ?? 'Remove condition'} ${index + 1}`}
                onClick={() =>
                  setBuilder((current) => ({
                    ...current,
                    conditions: {
                      version: 1,
                      items: current.conditions.items.filter((_, itemIndex) => itemIndex !== index),
                    },
                  }))
                }
              >
                {labels.remove ?? 'Remove'}
              </button>
            </div>
          ))}
          <button
            className="text-button"
            type="button"
            onClick={() =>
              setBuilder((current) => ({
                ...current,
                conditions: { version: 1, items: [...current.conditions.items, blankCondition()] },
              }))
            }
          >
            {labels.addCondition ?? 'Add condition'}
          </button>
        </fieldset>
        <fieldset className="rule-section">
          <legend>{labels.actions ?? 'Actions'}</legend>
          {builder.actions.items.map((item, index) => (
            <div className="rule-line" key={`${index}-${item.type}`}>
              <select
                aria-label={`${labels.action ?? 'Action'} ${index + 1}`}
                value={item.type}
                onChange={(event) =>
                  updateAction(
                    index,
                    event.target.value === 'mark_reviewed'
                      ? { type: 'mark_reviewed' }
                      : event.target.value === 'add_tag'
                        ? { type: 'add_tag', tagId: '' }
                        : event.target.value === 'secondary_category'
                          ? { type: 'secondary_category', categoryId: '' }
                          : { type: 'primary_category', categoryId: '' },
                  )
                }
              >
                <option value="primary_category">{labels.primaryCategory}</option>
                <option value="secondary_category">{labels.secondaryCategories}</option>
                <option value="add_tag">{labels.addTag ?? 'Add tag'}</option>
                <option value="mark_reviewed">{labels.markReviewed ?? 'Mark reviewed'}</option>
              </select>
              {item.type === 'primary_category' || item.type === 'secondary_category' ? (
                <select
                  aria-label={`${labels.actionValue ?? 'Action value'} ${index + 1}`}
                  value={item.categoryId}
                  onChange={(event) => updateAction(index, { categoryId: event.target.value })}
                >
                  <option value="">{labels.chooseCategory ?? 'Choose category'}</option>
                  {categories
                    .filter((category) => category.status === 'active')
                    .map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                </select>
              ) : item.type === 'add_tag' ? (
                <select
                  aria-label={`${labels.actionValue ?? 'Action value'} ${index + 1}`}
                  value={item.tagId}
                  onChange={(event) => updateAction(index, { tagId: event.target.value })}
                >
                  <option value="">{labels.chooseTag ?? 'Choose tag'}</option>
                  {tags
                    .filter((tag) => !tag.archivedAt)
                    .map((tag) => (
                      <option key={tag.id} value={tag.id}>
                        {tag.name}
                      </option>
                    ))}
                </select>
              ) : (
                <span className="rule-action-static">{labels.reviewed ?? 'Reviewed'}</span>
              )}
              <button
                className="text-button"
                type="button"
                aria-label={`${labels.removeAction ?? 'Remove action'} ${index + 1}`}
                onClick={() =>
                  setBuilder((current) => ({
                    ...current,
                    actions: {
                      version: 1,
                      items: current.actions.items.filter((_, itemIndex) => itemIndex !== index),
                    },
                  }))
                }
              >
                {labels.remove ?? 'Remove'}
              </button>
            </div>
          ))}
          <button
            className="text-button"
            type="button"
            onClick={() =>
              setBuilder((current) => ({
                ...current,
                actions: { version: 1, items: [...current.actions.items, blankAction()] },
              }))
            }
          >
            {labels.addAction ?? 'Add action'}
          </button>
        </fieldset>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="form-success" role="status">
            {notice}
          </p>
        )}
        <button className="primary-button" type="submit">
          {editingId ? (labels.saveRule ?? 'Save rule') : labels.create}
        </button>
      </form>
      <div className="rule-list-toolbar">
        <label className="check-row">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
          />
          {labels.showArchived ?? 'Show archived'}
        </label>
      </div>
      <div className="management-list">
        {rules.map((rule) => (
          <div className="management-row rule-row" key={rule.id}>
            <div>
              <strong>{rule.name}</strong>
              <p>
                {rule.enabled ? labels.enabled : (labels.disabled ?? labels.skipped)} ·{' '}
                {rule.applyScope === 'future_only' ? labels.futureOnly : labels.historicalAndFuture}{' '}
                · {labels.priority ?? 'Priority'} {rule.priority}
                {rule.archivedAt ? ` · ${labels.archived ?? 'Archived'}` : ''}
              </p>
              {preview[rule.id] && (
                <PreviewPanel
                  labels={labels}
                  preview={preview[rule.id]!}
                  categories={categories}
                  tags={tags}
                />
              )}
            </div>
            <div className="row-actions">
              <button className="text-button" type="button" onClick={() => edit(rule)}>
                {labels.edit ?? 'Edit'}
              </button>
              <button className="text-button" type="button" onClick={() => void previewRule(rule)}>
                {labels.preview}
              </button>
              {rule.applyScope === 'historical_and_future' && (
                <button
                  className="text-button"
                  type="button"
                  disabled={!preview[rule.id]}
                  onClick={() => {
                    setHistoricalRuleId(rule.id);
                    setHistoricalConfirmed(false);
                  }}
                >
                  {labels.applyHistorical}
                </button>
              )}
              <button
                className="text-button"
                type="button"
                onClick={() =>
                  void action(
                    rule,
                    rule.archivedAt ? 'restore' : rule.enabled ? 'disable' : 'enable',
                  )
                }
              >
                {rule.archivedAt
                  ? (labels.restore ?? 'Restore')
                  : rule.enabled
                    ? (labels.disable ?? 'Disable')
                    : (labels.enable ?? 'Enable')}
              </button>
              {!rule.archivedAt && (
                <button
                  className="text-button"
                  type="button"
                  onClick={() => void action(rule, 'archive')}
                >
                  {labels.archive ?? 'Archive'}
                </button>
              )}
              <button
                className="text-button"
                type="button"
                onClick={() => void loadHistory(rule.id)}
              >
                {labels.history}
              </button>
            </div>
          </div>
        ))}
        {!rules.length && <p className="empty-note">{labels.noRules}</p>}
      </div>
      {historicalRuleId && (
        <div className="workflow-dialog-backdrop">
          <div
            className="workflow-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="historical-title"
          >
            <h2 id="historical-title">{labels.applyHistorical}</h2>
            <p>{labels.confirmHistorical}</p>
            <p>
              {labels.manualProtection ?? 'Manual classifications stay protected'}:{' '}
              {preview[historicalRuleId]?.manualProtectedCount ?? 0}
            </p>
            <label className="check-row">
              <input
                type="checkbox"
                checked={historicalConfirmed}
                onChange={(event) => setHistoricalConfirmed(event.target.checked)}
              />
              {labels.confirmHistorical}
            </label>
            <div className="row-actions">
              <button
                className="primary-button"
                type="button"
                disabled={!historicalConfirmed}
                onClick={() => void applyHistorical()}
              >
                {labels.confirm ?? 'Confirm'}
              </button>
              <button className="text-button" type="button" onClick={() => setHistoricalRuleId('')}>
                {labels.cancel ?? 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
      {history && (
        <div className="workflow-dialog-backdrop">
          <div
            className="workflow-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-title"
          >
            <button
              className="text-button dialog-close"
              autoFocus
              type="button"
              onClick={() => setHistory(null)}
            >
              {labels.close ?? 'Close'}
            </button>
            <h2 id="history-title">{labels.history}</h2>
            {history.map((event) => (
              <div className="management-row" key={event.id}>
                <div>
                  <strong>{event.appliedAt}</strong>
                  <p>
                    {event.reason} · {event.transactionId}
                    {event.revertedAt ? ` · ${labels.reverted ?? 'Reverted'}` : ''}
                  </p>
                </div>
                {!event.revertedAt && (
                  <button className="text-button" type="button" onClick={() => void revert(event)}>
                    {labels.revert}
                  </button>
                )}
              </div>
            ))}
            {!history.length && <p className="empty-note">{labels.noHistory ?? 'No history.'}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewPanel({
  labels,
  preview,
  categories,
  tags,
}: {
  labels: Labels;
  preview: Preview;
  categories: Category[];
  tags: Tag[];
}) {
  const categoryName = (id: string) => categories.find((item) => item.id === id)?.name ?? id;
  const tagName = (id: string) => tags.find((item) => item.id === id)?.name ?? id;
  const actionSummary = [
    preview.actions.primaryCategoryId &&
      `${labels.primaryCategory}: ${categoryName(preview.actions.primaryCategoryId)}`,
    preview.actions.secondaryCategoryIds.length &&
      `${labels.secondaryCategories}: ${preview.actions.secondaryCategoryIds.map(categoryName).join(', ')}`,
    preview.actions.tagIds.length &&
      `${labels.tags}: ${preview.actions.tagIds.map(tagName).join(', ')}`,
    preview.actions.markReviewed && labels.markReviewed,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="rule-preview" role="status">
      <p>
        <strong>
          {labels.matches}: {preview.count}
        </strong>{' '}
        · {labels.conflicts}: {preview.manualProtectedCount} · {labels.skipped}:{' '}
        {preview.skipped.length}
      </p>
      <p>
        {labels.dateRange ?? 'Date range'}: {preview.dateRange.from ?? '—'} -{' '}
        {preview.dateRange.to ?? '—'}
      </p>
      <p>
        {labels.accounts ?? 'Accounts'}: {preview.accounts.join(', ') || '—'}
      </p>
      <p>
        {labels.actions ?? 'Actions'}: {actionSummary || '—'}
      </p>
      {preview.truncated && (
        <p className="form-warning">
          {labels.previewLimited ?? 'Preview is limited; historical application is unavailable.'}
        </p>
      )}
      <ul>
        {preview.sample.slice(0, 5).map((item) => (
          <li key={item.id}>
            {item.bookingDate} · {item.description} · {item.amount} {item.currencyCode} ·{' '}
            {item.accountName}
          </li>
        ))}
      </ul>
    </div>
  );
}
