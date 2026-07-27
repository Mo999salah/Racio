'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function ImportSummaryWorkspace({
  statementId,
  locale,
  statement,
  labels,
}: {
  statementId: string;
  locale: string;
  statement: {
    processingStatus: string;
    reconciliationStatus: string;
    reconciliationDifference: string | null;
    fileChecksum: string;
    fileSize: number;
  };
  labels: Record<string, string>;
}) {
  const router = useRouter();
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function confirm() {
    setBusy(true);
    const response = await fetch(`/api/imports/${statementId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmMismatch: ack, idempotencyKey: crypto.randomUUID() }),
    });
    if (response.ok) router.push(`/${locale}/accounts`);
    else {
      setError(labels.error ?? '');
      setBusy(false);
    }
  }
  const mismatch = statement.reconciliationStatus === 'mismatch';
  return (
    <div className="import-summary">
      <dl className="summary-list">
        <div>
          <dt>{labels.status}</dt>
          <dd>{statement.processingStatus}</dd>
        </div>
        <div>
          <dt>{labels.checksum}</dt>
          <dd className="account-identifier">{statement.fileChecksum}</dd>
        </div>
        <div>
          <dt>{labels.sourceFile}</dt>
          <dd>{statement.fileSize} bytes</dd>
        </div>
        <div>
          <dt>{labels.reconciliation}</dt>
          <dd>
            {labels[statement.reconciliationStatus] ?? statement.reconciliationStatus}
            {statement.reconciliationDifference ? ` (${statement.reconciliationDifference})` : ''}
          </dd>
        </div>
      </dl>
      {mismatch && (
        <label className="check-row">
          <input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} />{' '}
          {labels.confirmMismatch}
        </label>
      )}
      <p>{labels.confirmDescription}</p>
      <button
        className="primary-button"
        type="button"
        disabled={busy || (mismatch && !ack)}
        onClick={() => void confirm()}
      >
        {busy ? labels.busy : labels.confirm}
      </button>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
