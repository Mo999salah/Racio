'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Status = {
  enabled: boolean;
  providerId: string | null;
  model: string | null;
  remote: boolean;
};

type FactValue =
  | { kind: 'money'; amount: string; currency: string }
  | { kind: 'number'; value: number }
  | { kind: 'text'; value: string };

type Fact = {
  id: string;
  tool: string;
  label: string;
  value: FactValue;
  drilldown?: { kind: string; href: string };
};

type SearchRow = {
  id: string;
  bookingDate: string;
  amount: string;
  currency: string;
  direction: string;
  description: string;
  merchantName: string | null;
  categoryName: string | null;
  reviewed: boolean;
  accountName: string;
};

type ProposalDraft = {
  type: 'create_budget';
  currency: string | null;
  categoryId: string | null;
  accountId: string | null;
  name: string;
};

type ProposalPreview = {
  proposalId: string;
  preview: {
    type: string;
    currency?: string;
    amount?: string;
    period?: string;
    periodStart?: string;
    periodEnd?: string;
    currentSpent?: string;
    count?: number;
    categoryName?: string | null;
  };
};

type AnswerPayload = {
  text: string;
  facts: Fact[];
  searchResults: SearchRow[];
  drilldowns: { kind: string; href: string }[];
  scope: {
    dateRange: { from: string; to: string; key: string } | null;
    currency: string | null;
    accountId: string | null;
  };
  toolNames: string[];
  providerId: string | null;
  model: string | null;
  proposal: ProposalDraft | null;
};

type ClarificationOption = { id: string; label: string; dateRange: { from: string; to: string } };

type QueryResponse =
  | { status: 'answered'; threadId: string; messageId: string; answer: AnswerPayload }
  | { status: 'unsupported'; threadId: string; messageId: string; answer: AnswerPayload }
  | {
      status: 'needs_clarification';
      threadId: string;
      messageId: string;
      clarification: { reason: string; message: string; options: ClarificationOption[] };
    };

type ThreadSummary = {
  id: string;
  title: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ThreadMessage = { id: string; role: 'user' | 'assistant'; content: string; createdAt: string };

function formatAmount(value: string, currency: string, locale: string): string {
  const negative = value.startsWith('-');
  const absolute = negative ? value.slice(1) : value;
  const [whole = '0', fraction = ''] = absolute.split('.');
  const grouped = new Intl.NumberFormat(locale).format(Number(whole) || 0);
  const fractionText = fraction && /[1-9]/u.test(fraction) ? `.${fraction}` : '';
  return `${negative ? '-' : ''}${grouped}${fractionText} ${currency}`;
}

function factValueText(fact: Fact, locale: string): string {
  if (fact.value.kind === 'money')
    return formatAmount(fact.value.amount, fact.value.currency, locale);
  if (fact.value.kind === 'number') return new Intl.NumberFormat(locale).format(fact.value.value);
  return fact.value.value;
}

export function AdvisorWorkspace({
  locale,
  advanced,
  status,
  labels,
  errorLabels,
}: {
  locale: string;
  advanced: boolean;
  status: Status;
  labels: Record<string, string>;
  errorLabels: Record<string, string>;
}) {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState('');
  const [response, setResponse] = useState<QueryResponse | null>(null);
  const [threadId, setThreadId] = useState('');
  const [privacyDismissed, setPrivacyDismissed] = useState(false);

  // Conversation management.
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [openThread, setOpenThread] = useState<{ id: string; messages: ThreadMessage[] } | null>(
    null,
  );
  const [confirmDeleteId, setConfirmDeleteId] = useState('');
  const [threadsError, setThreadsError] = useState('');

  // Proposal draft flow (create_budget).
  const [draft, setDraft] = useState<ProposalDraft | null>(null);
  const [budgetName, setBudgetName] = useState('');
  const [budgetCurrency, setBudgetCurrency] = useState('');
  const [budgetAmount, setBudgetAmount] = useState('');
  const [budgetPeriod, setBudgetPeriod] = useState('monthly');
  const [preview, setPreview] = useState<ProposalPreview | null>(null);
  const [proposalNotice, setProposalNotice] = useState('');
  const [proposalError, setProposalError] = useState('');
  const [executedMessage, setExecutedMessage] = useState('');

  const resultRef = useRef<HTMLDivElement>(null);

  const text = (key: string) => labels[key] ?? '';
  const errorText = (code: string) => errorLabels[code] ?? errorLabels.INTERNAL ?? '';

  const loadThreads = useCallback(async () => {
    const response = await fetch('/api/advisor/threads', { cache: 'no-store' });
    if (response.ok) setThreads(await response.json());
    else setThreadsError(errorText('INTERNAL'));
  }, [errorText]);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  async function openConversation(id: string) {
    const response = await fetch(`/api/advisor/threads/${id}/messages`, { cache: 'no-store' });
    if (!response.ok) {
      setThreadsError(errorText('INTERNAL'));
      return;
    }
    const messages = await response.json();
    setOpenThread({ id, messages });
    setThreadId(id);
    setResponse(null);
  }

  async function archiveConversation(id: string) {
    const response = await fetch(`/api/advisor/threads/${id}/archive`, { method: 'POST' });
    if (!response.ok) {
      setThreadsError(errorText('INTERNAL'));
      return;
    }
    if (threadId === id) {
      setThreadId('');
      setOpenThread(null);
    }
    void loadThreads();
  }

  async function restoreConversation(id: string) {
    const response = await fetch(`/api/advisor/threads/${id}/restore`, { method: 'POST' });
    if (!response.ok) {
      setThreadsError(errorText('INTERNAL'));
      return;
    }
    void loadThreads();
  }

  async function deleteConversation(id: string) {
    const response = await fetch(`/api/advisor/threads/${id}`, { method: 'DELETE' });
    if (!response.ok) {
      setThreadsError(errorText('INTERNAL'));
      return;
    }
    if (threadId === id) {
      setThreadId('');
      setOpenThread(null);
    }
    setConfirmDeleteId('');
    void loadThreads();
  }

  async function submit(
    questionToAsk: string,
    context: { dateRange?: { from: string; to: string } } = {},
  ) {
    if (!questionToAsk.trim() || busy) return;
    setBusy(true);
    setErrorCode('');
    setProposalNotice('');
    setExecutedMessage('');
    try {
      const response = await fetch('/api/advisor/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: questionToAsk,
          threadId: threadId || undefined,
          context,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { code?: string };
        } | null;
        setErrorCode(payload?.error?.code ?? 'INTERNAL');
        return;
      }
      const data = (await response.json()) as QueryResponse;
      setThreadId(data.threadId);
      setResponse(data);
      if (data.status === 'answered') {
        if (data.answer.proposal) {
          setDraft(data.answer.proposal);
          setBudgetName(data.answer.proposal.name ?? '');
          setBudgetCurrency(data.answer.proposal.currency ?? '');
          setBudgetAmount('');
          setBudgetPeriod('monthly');
          setPreview(null);
        } else {
          setDraft(null);
        }
      } else {
        setDraft(null);
      }
      if (openThread && openThread.id === data.threadId) await openConversation(data.threadId);
      else setOpenThread(null);
      void loadThreads();
      window.setTimeout(() => {
        resultRef.current?.focus({ preventScroll: false });
      }, 0);
    } catch {
      setErrorCode('INTERNAL');
    } finally {
      setBusy(false);
    }
  }

  async function previewProposal() {
    setProposalError('');
    setProposalNotice('');
    if (!draft) return;
    const payload = {
      type: 'create_budget' as const,
      name: budgetName.trim() || 'Budget',
      currency: budgetCurrency.trim().toUpperCase(),
      amount: budgetAmount.trim(),
      period: budgetPeriod,
      categoryId: draft.categoryId,
      accountId: draft.accountId,
      rolloverEnabled: false,
    };
    const response = await fetch('/api/advisor/proposals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ proposal: payload }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: { code?: string };
      } | null;
      setProposalError(
        body?.error?.code === 'VALIDATION' ? 'VALIDATION' : (body?.error?.code ?? 'INTERNAL'),
      );
      return;
    }
    const data = await response.json();
    setPreview(data);
    setProposalNotice(text('proposalCreated'));
  }

  async function confirmProposal() {
    setProposalError('');
    if (!preview) return;
    const response = await fetch(`/api/advisor/proposals/${preview.proposalId}/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ proposalId: preview.proposalId }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: { code?: string };
      } | null;
      setProposalError(body?.error?.code ?? 'INTERNAL');
      return;
    }
    setExecutedMessage(text('proposalExecuted'));
    setPreview(null);
    setDraft(null);
  }

  function cancelProposal() {
    setPreview(null);
    setDraft(null);
    setProposalNotice('');
  }

  function startNewQuestion() {
    setThreadId('');
    setOpenThread(null);
    setResponse(null);
    setQuestion('');
    setConfirmDeleteId('');
  }

  const suggestions = [
    { key: 'suggestionSpending', prompt: text('suggestionSpending') },
    { key: 'suggestionCategories', prompt: text('suggestionCategories') },
    { key: 'suggestionBudget', prompt: text('suggestionBudget') },
    { key: 'suggestionUncategorized', prompt: text('suggestionUncategorized') },
    { key: 'suggestionGoal', prompt: text('suggestionGoal') },
  ].filter((suggestion) => suggestion.prompt);

  if (!status.enabled) {
    return (
      <div className="advisor-disabled" role="status">
        <h2>{text('aiDisabledTitle')}</h2>
        <p>{text('aiDisabledBody')}</p>
      </div>
    );
  }

  const answer =
    response?.status === 'answered' || response?.status === 'unsupported' ? response.answer : null;
  const clarification = response?.status === 'needs_clarification' ? response.clarification : null;

  return (
    <div className="advisor-workspace">
      {!privacyDismissed && (
        <aside className="advisor-privacy" aria-label={text('privacyTitle')}>
          <h2>{text('privacyTitle')}</h2>
          <p>{text('privacyBody')}</p>
          <button className="text-button" type="button" onClick={() => setPrivacyDismissed(true)}>
            {text('privacyContinue')}
          </button>
        </aside>
      )}

      <form
        className="advisor-ask"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(question);
        }}
      >
        <label htmlFor="advisor-question">{text('askLabel')}</label>
        <div className="advisor-ask-row">
          <textarea
            id="advisor-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={text('askPlaceholder')}
            rows={3}
            maxLength={2000}
            aria-describedby="advisor-question-hint"
          />
          <button className="primary-button" type="submit" disabled={busy || !question.trim()}>
            {busy ? text('loading') : text('submit')}
          </button>
        </div>
        <p className="field-hint" id="advisor-question-hint">
          {text('disclaimer')}
        </p>
      </form>

      <div className="advisor-suggestions" aria-label={text('askLabel')}>
        {suggestions.map((suggestion) => (
          <button
            className="advisor-suggestion"
            type="button"
            key={suggestion.key}
            disabled={busy}
            onClick={() => {
              setQuestion(suggestion.prompt);
              void submit(suggestion.prompt);
            }}
          >
            {suggestion.prompt}
          </button>
        ))}
      </div>

      <p className="form-error" role="alert" aria-live="assertive">
        {errorCode ? errorText(errorCode) : ''}
      </p>

      {busy ? (
        <p className="advisor-loading" role="status" aria-live="polite">
          {text('loading')}
        </p>
      ) : null}

      {openThread ? (
        <div className="advisor-result" ref={resultRef} tabIndex={-1} aria-live="polite">
          <section className="advisor-transcript" aria-labelledby="advisor-transcript-heading">
            <h2 id="advisor-transcript-heading">{text('conversationMessages')}</h2>
            {openThread.messages.length === 0 ? (
              <p className="planning-empty">{text('conversationsEmpty')}</p>
            ) : (
              <div className="advisor-transcript-list">
                {openThread.messages.map((message) => (
                  <div
                    className={`advisor-transcript-row advisor-transcript-${message.role}`}
                    key={message.id}
                  >
                    <span className="advisor-transcript-role">
                      {message.role === 'user'
                        ? text('conversationYou')
                        : text('conversationAssistant')}
                    </span>
                    <p>{message.content}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : clarification ? (
        <div className="advisor-result" ref={resultRef} tabIndex={-1} aria-live="polite">
          <section
            className="advisor-clarification"
            aria-labelledby="advisor-clarification-heading"
          >
            <h2 id="advisor-clarification-heading">{text('clarificationTitle')}</h2>
            <p>{clarification.message}</p>
            <div className="advisor-clarification-options">
              {clarification.options.map((option) => (
                <button
                  className="advisor-suggestion"
                  type="button"
                  key={option.id}
                  disabled={busy}
                  onClick={() => void submit(question, { dateRange: option.dateRange })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : answer ? (
        <div className="advisor-result" ref={resultRef} tabIndex={-1} aria-live="polite">
          <div className="advisor-scope" role="group" aria-label={text('scope')}>
            {answer.scope.dateRange ? (
              <span>
                {text('dateRange')}: {answer.scope.dateRange.from} – {answer.scope.dateRange.to}
              </span>
            ) : null}
            <span>
              {text('currency')}: {answer.scope.currency ?? text('allCurrencies')}
            </span>
            <span>
              {text('account')}:{' '}
              {answer.scope.accountId ? answer.scope.accountId : text('allAccounts')}
            </span>
          </div>

          {answer.text ? <div className="advisor-answer">{answer.text}</div> : null}

          {answer.facts.length > 0 && (
            <section className="advisor-facts" aria-labelledby="advisor-facts-heading">
              <h2 id="advisor-facts-heading">{text('verifiedFactsHeading')}</h2>
              <ul className="advisor-fact-list">
                {answer.facts.map((fact) => (
                  <li key={fact.id} className="advisor-fact-row">
                    {fact.drilldown ? (
                      <a className="advisor-fact-link" href={fact.drilldown.href}>
                        {fact.label}
                      </a>
                    ) : (
                      <span className="advisor-fact-label">{fact.label}</span>
                    )}
                    <span className="advisor-fact-value">{factValueText(fact, locale)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {answer.searchResults.length > 0 && (
            <section className="advisor-search" aria-labelledby="advisor-search-heading">
              <h2 id="advisor-search-heading">{text('searchResults')}</h2>
              <div className="sample-table-scroll">
                <table className="sample-table">
                  <caption className="visually-hidden">{text('searchResults')}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{labels.date ?? ''}</th>
                      <th scope="col">{labels.importedDescription ?? ''}</th>
                      <th scope="col">{labels.amount ?? ''}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {answer.searchResults.map((row) => (
                      <tr key={row.id}>
                        <td>{row.bookingDate}</td>
                        <td>
                          {row.description}
                          {row.categoryName ? <small> · {row.categoryName}</small> : null}
                          {row.merchantName ? <small> · {row.merchantName}</small> : null}
                        </td>
                        <td>{formatAmount(row.amount, row.currency, locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {draft && (
            <section className="advisor-proposal" aria-labelledby="advisor-proposal-heading">
              <h2 id="advisor-proposal-heading">{text('proposedAction')}</h2>
              {!preview ? (
                <div className="advisor-proposal-form">
                  <label>
                    {text('name') ?? 'Name'}
                    <input
                      value={budgetName}
                      onChange={(event) => setBudgetName(event.target.value)}
                    />
                  </label>
                  <label>
                    {text('currency')}
                    <input
                      value={budgetCurrency}
                      onChange={(event) => setBudgetCurrency(event.target.value)}
                      maxLength={3}
                      required
                    />
                  </label>
                  <label>
                    {text('amount') ?? 'Amount'}
                    <input
                      value={budgetAmount}
                      onChange={(event) => setBudgetAmount(event.target.value)}
                      inputMode="decimal"
                      required
                    />
                  </label>
                  <label>
                    {text('period') ?? 'Period'}
                    <select
                      value={budgetPeriod}
                      onChange={(event) => setBudgetPeriod(event.target.value)}
                    >
                      <option value="weekly">{labels.weekly ?? 'Weekly'}</option>
                      <option value="monthly">{labels.monthly ?? 'Monthly'}</option>
                      <option value="yearly">{labels.yearly ?? 'Yearly'}</option>
                    </select>
                  </label>
                  <div className="advisor-proposal-actions">
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() => void previewProposal()}
                    >
                      {text('preview')}
                    </button>
                    <button className="text-button" type="button" onClick={cancelProposal}>
                      {text('cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="advisor-proposal-preview">
                  <dl className="summary-list">
                    <div>
                      <dt>{text('name') ?? 'Name'}</dt>
                      <dd>{budgetName.trim() || 'Budget'}</dd>
                    </div>
                    <div>
                      <dt>{text('amount') ?? 'Amount'}</dt>
                      <dd>
                        {formatAmount(
                          preview.preview.amount ?? '',
                          preview.preview.currency ?? '',
                          locale,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>{text('period') ?? 'Period'}</dt>
                      <dd>{preview.preview.period ?? budgetPeriod}</dd>
                    </div>
                    {preview.preview.periodStart && preview.preview.periodEnd ? (
                      <div>
                        <dt>{text('dateRange')}</dt>
                        <dd>
                          {preview.preview.periodStart} – {preview.preview.periodEnd}
                        </dd>
                      </div>
                    ) : null}
                    {preview.preview.currentSpent !== undefined ? (
                      <div>
                        <dt>{text('suggestionBudget')}</dt>
                        <dd>
                          {formatAmount(
                            preview.preview.currentSpent,
                            preview.preview.currency ?? '',
                            locale,
                          )}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                  <div className="advisor-proposal-actions">
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() => void confirmProposal()}
                    >
                      {text('confirm')}
                    </button>
                    <button className="text-button" type="button" onClick={cancelProposal}>
                      {text('cancel')}
                    </button>
                  </div>
                </div>
              )}
              <p className="form-note" aria-live="polite">
                {proposalNotice}
                {proposalError === 'VALIDATION'
                  ? text('tamperedProposal')
                  : proposalError
                    ? errorText(proposalError)
                    : ''}
              </p>
              {executedMessage ? <p className="form-success">{executedMessage}</p> : null}
            </section>
          )}

          <details className="advisor-advanced" open={advanced}>
            <summary>{advanced ? text('advanced') : text('showAdvanced')}</summary>
            <p>
              {answer.scope.dateRange
                ? `${text('dateRange')}: ${answer.scope.dateRange.from} – ${answer.scope.dateRange.to} · `
                : ''}
              {text('currency')}: {answer.scope.currency ?? text('allCurrencies')}
            </p>
            <p>
              {text('providerStatus')}: {answer.providerId ?? text('disabled')}
              {answer.model ? ` · ${answer.model}` : ''}
            </p>
            {answer.toolNames.length > 0 ? <p>Tools: {answer.toolNames.join(', ')}</p> : null}
          </details>

          <div className="advisor-actions">
            <button className="text-button" type="button" onClick={startNewQuestion}>
              {text('newThread')}
            </button>
          </div>
        </div>
      ) : null}

      <section className="advisor-conversations" aria-labelledby="advisor-conversations-heading">
        <div className="advisor-conversations-heading">
          <h2 id="advisor-conversations-heading">{text('conversations')}</h2>
        </div>
        {threads.length === 0 ? (
          <p className="advisor-conversations-empty">{text('conversationsEmpty')}</p>
        ) : (
          <ul className="advisor-conversation-list">
            {threads.map((thread) => (
              <li className="advisor-conversation-row" key={thread.id}>
                <div className="advisor-conversation-main">
                  <button
                    className="advisor-conversation-title"
                    type="button"
                    onClick={() => void openConversation(thread.id)}
                  >
                    {thread.title ?? text('conversationUntitled')}
                  </button>
                  <small>{new Date(thread.updatedAt).toLocaleDateString(locale)}</small>
                  {thread.archivedAt ? (
                    <span className="advisor-archived-badge">{text('conversationArchived')}</span>
                  ) : null}
                </div>
                <div className="advisor-conversation-actions">
                  {thread.archivedAt ? (
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => void restoreConversation(thread.id)}
                    >
                      {text('conversationRestore')}
                    </button>
                  ) : (
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => void archiveConversation(thread.id)}
                    >
                      {text('conversationArchive')}
                    </button>
                  )}
                  {confirmDeleteId === thread.id ? (
                    <>
                      <button
                        className="text-button danger"
                        type="button"
                        onClick={() => void deleteConversation(thread.id)}
                      >
                        {text('conversationConfirmDelete')}
                      </button>
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => setConfirmDeleteId('')}
                      >
                        {text('cancel')}
                      </button>
                    </>
                  ) : (
                    <button
                      className="text-button danger"
                      type="button"
                      onClick={() => setConfirmDeleteId(thread.id)}
                    >
                      {text('conversationDelete')}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="form-error" role="alert">
          {threadsError}
        </p>
      </section>
    </div>
  );
}
