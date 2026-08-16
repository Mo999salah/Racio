'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type Labels = Record<string, string>;
type FilterState = Record<string, string>;
type ExportType = 'transactions_csv' | 'transactions_xlsx' | 'account_archive';
type ExportStatus = 'preparing' | 'ready' | 'failed';

type ExportRecord = {
  id: string;
  type: ExportType;
  status: ExportStatus;
  rowCount: number | null;
  sizeBytes: number | null;
  checksum: string | null;
  errorCode: string | null;
  fileName: string;
  contentType: string;
  expired: boolean;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string | null;
};

type NamedEntity = { id: string; name: string };

function text(labels: Labels, key: string) {
  return labels[key] ?? '';
}

const TYPE_LABEL_KEY: Record<ExportType, string> = {
  transactions_csv: 'typeTransactionsCsv',
  transactions_xlsx: 'typeTransactionsXlsx',
  account_archive: 'typeAccountArchive',
};

function formatBytes(value: number | null): string {
  if (value === null) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string | null, locale: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function ExportWorkspace({
  labels,
  txLabels,
  locale,
  advanced,
  initialFilters,
  estimatedRows,
}: {
  labels: Labels;
  txLabels: Labels;
  locale: string;
  advanced: boolean;
  initialFilters: FilterState | null;
  estimatedRows: number;
}) {
  const [format, setFormat] = useState<'csv' | 'xlsx'>('csv');
  const [includeNotes, setIncludeNotes] = useState(false);
  const [includeSplits, setIncludeSplits] = useState(false);
  const [archiveNotes, setArchiveNotes] = useState(false);
  const [includeAdvisor, setIncludeAdvisor] = useState(false);
  const [generating, setGenerating] = useState<'csv' | 'xlsx' | 'archive' | null>(null);
  const [notice, setNotice] = useState('');
  const [history, setHistory] = useState<ExportRecord[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<NamedEntity[]>([]);
  const [categories, setCategories] = useState<NamedEntity[]>([]);
  const [institutions, setInstitutions] = useState<NamedEntity[]>([]);
  const [tags, setTags] = useState<NamedEntity[]>([]);
  const [views, setViews] = useState<NamedEntity[]>([]);

  const scope = useMemo(() => {
    if (!initialFilters) return null;
    const byId = (list: NamedEntity[], id: string | undefined) =>
      list.find((item) => item.id === id)?.name ?? id ?? '';
    const items: string[] = [];
    if (initialFilters.dateFrom || initialFilters.dateTo) {
      items.push(
        [initialFilters.dateFrom, initialFilters.dateTo].filter(Boolean).join(' – ') ||
          text(labels, 'noScope'),
      );
    }
    if (initialFilters.accountId) items.push(byId(accounts, initialFilters.accountId));
    if (initialFilters.institutionId) items.push(byId(institutions, initialFilters.institutionId));
    if (initialFilters.direction) items.push(text(txLabels, initialFilters.direction));
    if (initialFilters.currency) items.push(initialFilters.currency);
    if (initialFilters.primaryCategoryId)
      items.push(byId(categories, initialFilters.primaryCategoryId));
    if (initialFilters.secondaryCategoryId)
      items.push(byId(categories, initialFilters.secondaryCategoryId));
    if (initialFilters.tagId) items.push(byId(tags, initialFilters.tagId));
    if (initialFilters.reviewed)
      items.push(
        initialFilters.reviewed === 'true'
          ? text(txLabels, 'reviewed')
          : text(txLabels, 'notReviewed'),
      );
    if (initialFilters.categorised)
      items.push(
        initialFilters.categorised === 'true'
          ? text(txLabels, 'categorisedYes')
          : text(txLabels, 'uncategorised'),
      );
    if (initialFilters.search) items.push(initialFilters.search);
    if (initialFilters.amountExact) items.push(initialFilters.amountExact);
    if (initialFilters.amountMin) items.push(`≥ ${initialFilters.amountMin}`);
    if (initialFilters.amountMax) items.push(`≤ ${initialFilters.amountMax}`);
    if (initialFilters.includeArchived === 'true') items.push(text(txLabels, 'includeArchived'));
    if (initialFilters.savedViewId) items.push(byId(views, initialFilters.savedViewId));
    return items;
  }, [initialFilters, accounts, categories, institutions, tags, views, labels, txLabels]);

  const loadHistory = useCallback(async () => {
    const response = await fetch('/api/exports', { cache: 'no-store' });
    if (response.ok) setHistory(await response.json());
  }, []);

  useEffect(() => {
    void loadHistory();
    void Promise.all([
      fetch('/api/accounts', { cache: 'no-store' }),
      fetch('/api/categories', { cache: 'no-store' }),
      fetch('/api/institutions', { cache: 'no-store' }),
      fetch('/api/tags', { cache: 'no-store' }),
      fetch('/api/saved-views', { cache: 'no-store' }),
    ]).then(async ([a, c, i, t, v]) => {
      if (a.ok) setAccounts(await a.json());
      if (c.ok) setCategories(await c.json());
      if (i.ok) setInstitutions(await i.json());
      if (t.ok) setTags(await t.json());
      if (v.ok) setViews(await v.json());
    });
  }, [loadHistory]);

  useEffect(() => {
    const preparing = history.some((item) => item.status === 'preparing');
    if (!preparing) return;
    const timer = setInterval(() => void loadHistory(), 3000);
    return () => clearInterval(timer);
  }, [history, loadHistory]);

  const preparingCount = history.filter((item) => item.status === 'preparing').length;

  async function generate(kind: 'csv' | 'xlsx' | 'archive') {
    setGenerating(kind);
    setNotice('');
    const payload =
      kind === 'archive'
        ? {
            type: 'account_archive',
            includeNotes: archiveNotes,
            includeAdvisorConversations: includeAdvisor,
          }
        : kind === 'xlsx'
          ? {
              type: 'transactions_xlsx',
              filters: initialFilters ?? {},
              includeNotes,
              includeSplits,
            }
          : {
              type: 'transactions_csv',
              filters: initialFilters ?? {},
              includeNotes,
            };
    const response = await fetch('/api/exports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      const code = (data as { error?: { code?: string } } | null)?.error?.code;
      setNotice(
        code === 'EXPORT_BUSY'
          ? text(labels, 'busy')
          : code === 'EXPORT_TOO_MANY_ROWS'
            ? text(labels, 'tooManyRows')
            : text(labels, 'error'),
      );
      setGenerating(null);
      return;
    }
    setGenerating(null);
    await loadHistory();
  }

  async function remove(id: string) {
    const response = await fetch(`/api/exports/${id}`, { method: 'DELETE' });
    if (response.ok) {
      setConfirmDeleteId(null);
      await loadHistory();
    } else {
      setNotice(text(labels, 'error'));
    }
  }

  const transactionCount =
    initialFilters === null ? null : estimatedRows < 0 ? null : estimatedRows;

  return (
    <div className="export-workspace">
      <p aria-live="polite" className="visually-hidden">
        {preparingCount > 0
          ? `${preparingCount} ${text(labels, 'preparing')}`
          : generating
            ? text(labels, 'generating')
            : ''}
      </p>
      {notice ? <p className="form-error">{notice}</p> : null}

      <section className="export-section" aria-labelledby="export-transactions-title">
        <div className="export-section-head">
          <h2 id="export-transactions-title">{text(labels, 'transactionsHeading')}</h2>
          <p>{text(labels, 'transactionsBody')}</p>
        </div>

        {initialFilters ? (
          <div className="export-scope">
            <p className="export-scope-label">
              <span>{text(labels, 'filterSummary')}</span>
              <a className="text-button" href={`/${locale}/export`}>
                {text(labels, 'clearScope')}
              </a>
            </p>
            {scope && scope.length > 0 ? (
              <ul className="export-scope-list">
                {scope.map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="export-scope-empty">{text(labels, 'noScope')}</p>
            )}
            {transactionCount !== null && (
              <p className="export-estimate">
                {text(labels, 'estimatedRows')}: <strong>{transactionCount}</strong>
                {transactionCount === 0 ? ` — ${text(labels, 'noMatching')}` : ''}
              </p>
            )}
          </div>
        ) : (
          <p className="export-scope-empty">{text(labels, 'noScope')}</p>
        )}

        <fieldset className="export-format-fieldset">
          <legend>{text(labels, 'format')}</legend>
          <div className="export-format-options">
            <label className="export-format-option">
              <input
                type="radio"
                name="export-format"
                value="csv"
                checked={format === 'csv'}
                onChange={() => setFormat('csv')}
              />
              <span>{text(labels, 'formatCsv')}</span>
            </label>
            <label className="export-format-option">
              <input
                type="radio"
                name="export-format"
                value="xlsx"
                checked={format === 'xlsx'}
                onChange={() => setFormat('xlsx')}
              />
              <span>{text(labels, 'formatXlsx')}</span>
            </label>
          </div>
        </fieldset>

        <div className="export-options">
          <label className="export-check">
            <input
              type="checkbox"
              checked={includeNotes}
              onChange={(event) => setIncludeNotes(event.target.checked)}
            />
            <span>
              {text(labels, 'includeNotes')}
              <small>{text(labels, 'includeNotesHint')}</small>
            </span>
          </label>
          {format === 'xlsx' ? (
            <label className="export-check">
              <input
                type="checkbox"
                checked={includeSplits}
                onChange={(event) => setIncludeSplits(event.target.checked)}
              />
              <span>
                {text(labels, 'includeSplits')}
                <small>{text(labels, 'includeSplitsHint')}</small>
              </span>
            </label>
          ) : null}
        </div>

        <div className="export-actions">
          <button
            type="button"
            className="primary-button"
            disabled={generating !== null}
            onClick={() => void generate(format)}
          >
            {generating === format ? text(labels, 'generating') : text(labels, 'generate')}
          </button>
        </div>
      </section>

      <section className="export-section" aria-labelledby="export-archive-title">
        <div className="export-section-head">
          <h2 id="export-archive-title">{text(labels, 'archiveHeading')}</h2>
          <p>{text(labels, 'archiveBody')}</p>
        </div>
        <div className="export-options">
          <label className="export-check">
            <input
              type="checkbox"
              checked={archiveNotes}
              onChange={(event) => setArchiveNotes(event.target.checked)}
            />
            <span>
              {text(labels, 'includeNotes')}
              <small>{text(labels, 'includeNotesHint')}</small>
            </span>
          </label>
          {advanced ? (
            <label className="export-check">
              <input
                type="checkbox"
                checked={includeAdvisor}
                onChange={(event) => setIncludeAdvisor(event.target.checked)}
              />
              <span>
                {text(labels, 'includeAdvisor')}
                <small>{text(labels, 'includeAdvisorHint')}</small>
              </span>
            </label>
          ) : null}
        </div>
        <div className="export-actions">
          <button
            type="button"
            className="primary-button"
            disabled={generating !== null}
            onClick={() => void generate('archive')}
          >
            {generating === 'archive' ? text(labels, 'generating') : text(labels, 'generate')}
          </button>
        </div>
      </section>

      <section className="export-section" aria-labelledby="export-history-title">
        <div className="export-section-head">
          <h2 id="export-history-title">{text(labels, 'history')}</h2>
          <p>
            {text(labels, 'fileExpires')}: {text(labels, 'expiryHours')}
          </p>
        </div>
        {history.length === 0 ? (
          <p className="export-scope-empty">{text(labels, 'historyEmpty')}</p>
        ) : (
          <div className="export-history" role="table" aria-label={text(labels, 'history')}>
            <div className="export-history-row export-history-head" role="row">
              <span role="columnheader">{text(labels, 'type')}</span>
              <span role="columnheader">{text(labels, 'status')}</span>
              <span role="columnheader">{text(labels, 'generatedDate')}</span>
              <span role="columnheader">{text(labels, 'size')}</span>
              <span role="columnheader">{text(labels, 'rows')}</span>
              <span role="columnheader">{text(labels, 'fileExpires')}</span>
              <span role="columnheader" className="export-history-actions">
                {text(labels, 'actions')}
              </span>
            </div>
            {history.map((item) => {
              const statusKey = item.expired ? 'expired' : item.status;
              const canDownload = item.status === 'ready' && !item.expired;
              return (
                <div className="export-history-row" role="row" key={item.id}>
                  <span role="cell">{text(labels, TYPE_LABEL_KEY[item.type])}</span>
                  <span role="cell">
                    <span className={`export-status export-status-${statusKey}`}>
                      <span className="export-status-mark" aria-hidden="true" />
                      {text(labels, statusKey)}
                    </span>
                  </span>
                  <span role="cell">{formatDate(item.createdAt, locale)}</span>
                  <span role="cell">{formatBytes(item.sizeBytes)}</span>
                  <span role="cell">{item.rowCount !== null ? String(item.rowCount) : '—'}</span>
                  <span role="cell">{formatDate(item.expiresAt, locale)}</span>
                  <span role="cell" className="export-history-actions">
                    {canDownload ? (
                      <a className="text-button" href={`/api/exports/${item.id}/download`}>
                        {text(labels, 'download')}
                      </a>
                    ) : null}
                    {confirmDeleteId === item.id ? (
                      <button
                        type="button"
                        className="text-button danger"
                        onClick={() => void remove(item.id)}
                      >
                        {text(labels, 'deleteConfirm')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="text-button danger"
                        onClick={() => {
                          setConfirmDeleteId(item.id);
                          window.setTimeout(() => {
                            setConfirmDeleteId((current) => (current === item.id ? null : current));
                          }, 5000);
                        }}
                      >
                        {text(labels, 'delete')}
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <aside className="export-privacy" aria-label={text(labels, 'privacyTitle')}>
        <p className="eyebrow">{text(labels, 'privacyTitle')}</p>
        <p>{text(labels, 'privacyBody')}</p>
      </aside>
    </div>
  );
}
