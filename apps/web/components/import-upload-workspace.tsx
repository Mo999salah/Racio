'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function ImportUploadWorkspace({
  accountId,
  accountName,
  locale,
  labels,
}: {
  accountId: string;
  accountName: string;
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
      setError(
        body?.error?.code === 'CONFLICT' ? (labels.alreadyUploaded ?? '') : (labels.error ?? ''),
      );
      setBusy(false);
      return;
    }
    setMessage(labels.busy ?? '');
    const id = body.statement.id;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const statusResponse = await fetch(`/api/imports/${id}`, { cache: 'no-store' });
      const status = (await statusResponse.json()) as { processingStatus?: string };
      if (status.processingStatus === 'needs_mapping') {
        router.push(`/${locale}/imports/${id}/mapping`);
        return;
      }
      if (status.processingStatus === 'needs_review' || status.processingStatus === 'ready') {
        router.push(`/${locale}/imports/${id}/review`);
        return;
      }
      if (status.processingStatus === 'failed') {
        setError(labels.error ?? '');
        setBusy(false);
        return;
      }
    }
    router.push(`/${locale}/imports/${id}/review`);
  }

  return (
    <div className="import-workspace">
      <p className="status-note">
        <strong>{labels.account}:</strong> {accountName}
      </p>
      <form className="import-form" onSubmit={submit}>
        <label>
          {labels.chooseFile}
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            required
          />
        </label>
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
