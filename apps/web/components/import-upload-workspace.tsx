'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function ImportUploadWorkspace({
  accountId,
  accountName,
  institutionName,
  accountCurrency,
  locale,
  labels,
}: {
  accountId: string;
  accountName: string;
  institutionName: string;
  accountCurrency: string;
  locale: string;
  labels: Record<string, string>;
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [retain, setRetain] = useState(false);
  const [reprocess, setReprocess] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError('');
    setMessage('');
    const form = new FormData();
    form.set('file', file);
    form.set('accountId', accountId);
    form.set('retainOriginalFile', String(retain));
    form.set('reprocess', String(reprocess));
    form.set('idempotencyKey', crypto.randomUUID());
    const response = await fetch('/api/imports', { method: 'POST', body: form });
    const body = (await response.json().catch(() => null)) as {
      statement?: { id: string; processingStatus: string };
      error?: { code?: string };
    } | null;
    if (!response.ok || !body?.statement) {
      const code = body?.error?.code;
      setError(
        code === 'CONFLICT'
          ? (labels.alreadyUploaded ?? '')
          : code && labels[`error_${code}`]
            ? (labels[`error_${code}`] ?? labels.error ?? '')
            : (labels.error ?? ''),
      );
      setBusy(false);
      return;
    }
    setMessage(labels.busy ?? '');
    const id = body.statement.id;
    for (let attempt = 0; attempt < 70; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const statusResponse = await fetch(`/api/imports/${id}`, { cache: 'no-store' });
      const status = (await statusResponse.json()) as { processingStatus?: string };
      if (status.processingStatus === 'needs_mapping') {
        router.push(`/${locale}/imports/${id}/mapping`);
        return;
      }
      if (status.processingStatus === 'needs_sheet_selection') {
        router.push(`/${locale}/imports/${id}/sheet`);
        return;
      }
      if (status.processingStatus === 'needs_review' || status.processingStatus === 'ready') {
        router.push(`/${locale}/imports/${id}/review`);
        return;
      }
      if (status.processingStatus === 'failed') {
        const failed = status as { lastErrorCode?: string };
        setError(
          failed.lastErrorCode && labels[`error_${failed.lastErrorCode}`]
            ? (labels[`error_${failed.lastErrorCode}`] ?? labels.error ?? '')
            : (labels.error ?? ''),
        );
        setBusy(false);
        return;
      }
    }
    setError(labels.timeout ?? labels.error ?? '');
    setBusy(false);
  }

  return (
    <div className="import-workspace">
      <dl className="import-source-summary">
        <div>
          <dt>{labels.account}</dt>
          <dd>{accountName}</dd>
        </div>
        <div>
          <dt>{labels.institution}</dt>
          <dd>{institutionName}</dd>
        </div>
        <div>
          <dt>{labels.accountCurrency}</dt>
          <dd>{accountCurrency}</dd>
        </div>
      </dl>
      <form className="import-form" onSubmit={submit}>
        <label>
          {labels.chooseFile}
          <input
            type="file"
            accept=".csv,.xlsx,.pdf,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            required
          />
        </label>
        {file && (
          <p className="selected-file" role="status">
            <strong>{labels.selectedFile}:</strong> {file.name} · {file.size} {labels.bytes}
          </p>
        )}
        {file?.name.toLowerCase().endsWith('.xlsx') && (
          <div className="workbook-notice">
            <strong>{labels.workbookSecurityTitle}</strong>
            <p>{labels.workbookSecurityNotice}</p>
            <p>{labels.workbookUnsupportedNotice}</p>
          </div>
        )}
        {file?.name.toLowerCase().endsWith('.pdf') && (
          <div className="workbook-notice">
            <strong>{labels.pdfSecurityTitle}</strong>
            <p>{labels.pdfSecurityNotice}</p>
            <p>{labels.pdfScannedNotice}</p>
          </div>
        )}
        <p className="field-hint">{labels.legacyExcelNotice}</p>
        <label className="check-row">
          <input
            type="checkbox"
            checked={retain}
            onChange={(event) => setRetain(event.target.checked)}
          />{' '}
          {labels.retention}
        </label>
        <p className="field-hint">{labels.retentionHint}</p>
        <label className="check-row">
          <input
            type="checkbox"
            checked={reprocess}
            onChange={(event) => setReprocess(event.target.checked)}
          />{' '}
          {labels.reprocess}
        </label>
        <button className="primary-button" type="submit" disabled={busy || !file}>
          {busy ? labels.busy : labels.upload}
        </button>
        {message && <p className="status-text">{message}</p>}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
