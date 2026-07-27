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
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const response = await fetch(`/api/imports/${statementId}/mapping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapping }),
    });
    if (!response.ok) {
      setError(labels.error ?? '');
      setBusy(false);
      return;
    }
    router.push(`/${locale}/imports/${statementId}/review`);
  }
  return (
    <form className="import-mapping" onSubmit={submit}>
      <p>{labels.mappingDescription}</p>
      <div className="mapping-grid">
        {fields
          .filter((field) => advanced || ['bookingDate', 'description', 'amount'].includes(field))
          .map((field) => (
            <label key={field}>
              {field}
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
            </label>
          ))}
      </div>
      <label>
        {labels.date}
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
