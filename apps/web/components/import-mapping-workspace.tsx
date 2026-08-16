'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const fields = [
  'bookingDate',
  'valueDate',
  'description',
  'amount',
  'debit',
  'credit',
  'currency',
  'balance',
  'counterparty',
  'transactionIdentifier',
] as const;

export function ImportMappingWorkspace({
  statementId,
  locale,
  initial,
  advanced,
  labels,
}: {
  statementId: string;
  locale: string;
  initial: Record<string, unknown> | null;
  advanced: boolean;
  labels: Record<string, string>;
}) {
  const router = useRouter();
  const [mapping, setMapping] = useState<Record<string, unknown>>({
    headerRow: 0,
    bookingDate: null,
    valueDate: null,
    description: null,
    amount: null,
    debit: null,
    credit: null,
    currency: null,
    balance: null,
    counterparty: null,
    transactionIdentifier: null,
    decimalSeparator: null,
    thousandsSeparator: null,
    dateFormat: null,
    ...initial,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isXlsx = mapping.sourceType === 'xlsx';
  function columnLetter(value: unknown) {
    if (typeof value !== 'number' || value < 0) return labels.notMapped;
    let current = value + 1;
    let result = '';
    while (current > 0) {
      current -= 1;
      result = String.fromCharCode(65 + (current % 26)) + result;
      current = Math.floor(current / 26);
    }
    return result;
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const submittedMapping = isXlsx
      ? {
          ...mapping,
          columnLetters: Object.fromEntries(
            fields
              .filter((field) => typeof mapping[field] === 'number')
              .map((field) => [field, columnLetter(mapping[field])]),
          ),
        }
      : mapping;
    const response = await fetch(`/api/imports/${statementId}/mapping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapping: submittedMapping }),
    });
    if (!response.ok) {
      setError(labels.error ?? '');
      setBusy(false);
      return;
    }
    for (let attempt = 0; attempt < 70; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const statusResponse = await fetch(`/api/imports/${statementId}`, { cache: 'no-store' });
      const status = (await statusResponse.json().catch(() => null)) as {
        processingStatus?: string;
        lastErrorCode?: string;
      } | null;
      if (status?.processingStatus === 'needs_review' || status?.processingStatus === 'ready') {
        router.push(`/${locale}/imports/${statementId}/review`);
        return;
      }
      if (status?.processingStatus === 'needs_mapping') {
        setError(labels.mappingStillAmbiguous ?? labels.error ?? '');
        setBusy(false);
        return;
      }
      if (status?.processingStatus === 'failed') {
        setError(
          status.lastErrorCode && labels[`error_${status.lastErrorCode}`]
            ? (labels[`error_${status.lastErrorCode}`] ?? labels.error ?? '')
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
    <form className="import-mapping" onSubmit={submit} aria-busy={busy}>
      <p>{labels.mappingDescription}</p>
      {isXlsx && (
        <div className="xlsx-mapping-source">
          <p>
            <strong>{labels.selectedWorksheet}:</strong> {String(mapping.selectedSheetName ?? '')}
          </p>
          <div className="mapping-range">
            <label>
              {labels.headerRow}
              <input
                type="number"
                min="1"
                value={String(mapping.headerRow ?? '')}
                onChange={(event) =>
                  setMapping({ ...mapping, headerRow: Number(event.target.value) })
                }
                required
              />
            </label>
            <label>
              {labels.firstDataRow}
              <input
                type="number"
                min="1"
                value={String(mapping.firstDataRow ?? '')}
                onChange={(event) =>
                  setMapping({ ...mapping, firstDataRow: Number(event.target.value) })
                }
                required
              />
            </label>
            <label>
              {labels.lastDataRow}
              <input
                type="number"
                min="1"
                value={typeof mapping.lastDataRow === 'number' ? String(mapping.lastDataRow) : ''}
                onChange={(event) =>
                  setMapping({
                    ...mapping,
                    lastDataRow: event.target.value ? Number(event.target.value) : null,
                  })
                }
              />
            </label>
          </div>
        </div>
      )}
      <div className="mapping-grid">
        {fields
          .filter((field) => advanced || ['bookingDate', 'description', 'amount'].includes(field))
          .map((field) => (
            <label key={field}>
              {labels[`field_${field}`] ?? field}
              <input
                type="number"
                min="0"
                value={typeof mapping[field] === 'number' ? String(mapping[field]) : ''}
                onChange={(event) =>
                  setMapping({
                    ...mapping,
                    [field]: event.target.value === '' ? null : Number(event.target.value),
                  })
                }
              />
              {isXlsx && (
                <>
                  <span className="field-hint">
                    {labels.sourceColumn}: {columnLetter(mapping[field])}
                  </span>
                  {advanced && (
                    <span className="field-hint">
                      {labels.cellType}:{' '}
                      {String(
                        (mapping.cellTypeHints as Record<string, unknown> | undefined)?.[field] ??
                          labels.notApplicable,
                      )}
                      {' · '}
                      {labels.numberFormat}:{' '}
                      {String(
                        (mapping.numberFormatHints as Record<string, unknown> | undefined)?.[
                          field
                        ] ?? labels.notApplicable,
                      )}
                    </span>
                  )}
                </>
              )}
            </label>
          ))}
      </div>
      <label>
        {labels.dateFormat}
        <input
          value={String(mapping.dateFormat ?? '')}
          placeholder="%d.%m.%Y"
          onChange={(event) => setMapping({ ...mapping, dateFormat: event.target.value || null })}
        />
      </label>
      <button className="primary-button" type="submit" disabled={busy}>
        {busy ? labels.busy : labels.saveMapping}
      </button>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
