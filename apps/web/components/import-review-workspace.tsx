'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Row = {
  id: string;
  sourceRow: number;
  rawDescription: string;
  bookingDate: string | null;
  amount: string | null;
  currencyCode: string | null;
  direction: string;
  reviewStatus: string;
  warnings: unknown;
  rawPayload: unknown;
};

export function ImportReviewWorkspace({
  statementId,
  locale,
  advanced,
  labels,
}: {
  statementId: string;
  locale: string;
  advanced: boolean;
  labels: Record<string, string>;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState('');
  async function refresh() {
    const response = await fetch(`/api/imports/${statementId}/review`, { cache: 'no-store' });
    if (response.ok) setRows(await response.json());
  }
  useEffect(() => {
    void refresh();
  }, []);
  async function update(row: Row, action: 'exclude' | 'restore' | 'mark-reviewed') {
    setError('');
    const response = await fetch(`/api/imports/${statementId}/rows/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        bookingDate: row.bookingDate,
        description: row.rawDescription,
        amount: row.amount,
        currency: row.currencyCode,
        direction: row.direction,
      }),
    });
    if (!response.ok) setError(labels.error ?? '');
    else await refresh();
  }
  function editRow(id: string, field: keyof Row, value: string) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  }
  const needsAttention = rows.filter(
    (row) => row.reviewStatus !== 'valid' && row.reviewStatus !== 'excluded',
  ).length;
  function warningsFor(row: Row) {
    return Array.isArray(row.warnings)
      ? row.warnings.filter((warning): warning is string => typeof warning === 'string')
      : [];
  }
  function workbookFor(row: Row) {
    if (!row.rawPayload || typeof row.rawPayload !== 'object' || !('workbook' in row.rawPayload))
      return null;
    const workbook = row.rawPayload.workbook;
    return workbook && typeof workbook === 'object'
      ? (workbook as {
          sheetName?: string;
          sheetIndex?: number;
          sourceRow?: number;
          cells?: Array<{
            coordinate?: string;
            rawType?: string;
            numberFormat?: string;
            hasCachedValue?: boolean;
          }>;
        })
      : null;
  }
  async function markAllReviewed() {
    for (const row of rows.filter(
      (item) => item.reviewStatus !== 'valid' && item.reviewStatus !== 'excluded',
    )) {
      await update(row, 'mark-reviewed');
    }
  }
  return (
    <div className="import-review">
      <p className="status-note">{labels.reviewDescription}</p>
      {needsAttention > 0 && (
        <button className="text-button" type="button" onClick={() => void markAllReviewed()}>
          {labels.markAllReviewed}
        </button>
      )}
      <div className="review-list">
        {rows.map((row) => (
          <article className="review-row" key={row.id}>
            <div>
              <span className="row-number">
                {labels.row} {row.sourceRow}
              </span>
              <label className="review-field">
                {labels.descriptionField}
                <input
                  value={row.rawDescription}
                  onChange={(event) => editRow(row.id, 'rawDescription', event.target.value)}
                />
              </label>
              <label className="review-field">
                {labels.date}
                <input
                  type="date"
                  value={row.bookingDate ?? ''}
                  onChange={(event) => editRow(row.id, 'bookingDate', event.target.value)}
                />
              </label>
              <label className="review-field">
                {labels.amount}
                <input
                  inputMode="decimal"
                  value={row.amount ?? ''}
                  onChange={(event) => editRow(row.id, 'amount', event.target.value)}
                />
              </label>
              <p>
                {row.currencyCode || ''} · {labels[row.direction] ?? row.direction}
              </p>
              <p className={row.reviewStatus === 'valid' ? 'status-text' : 'error-text'}>
                {labels[row.reviewStatus] ?? row.reviewStatus}
              </p>
              {warningsFor(row).length > 0 && (
                <div className="row-warnings" role="status">
                  <strong>{labels.warnings}</strong>
                  <ul>
                    {warningsFor(row).map((warning) => (
                      <li key={warning}>{labels[`warning_${warning}`] ?? labels.rowWarning}</li>
                    ))}
                  </ul>
                </div>
              )}
              {advanced && workbookFor(row) && (
                <details className="workbook-diagnostics">
                  <summary>{labels.xlsxDiagnostics}</summary>
                  <p>
                    {labels.selectedWorksheet}: {workbookFor(row)?.sheetName}
                  </p>
                  <p>
                    {labels.sourceRow}: {workbookFor(row)?.sourceRow}
                  </p>
                  <div className="sample-table-scroll" tabIndex={0}>
                    <table className="sample-table">
                      <thead>
                        <tr>
                          <th scope="col">{labels.cellCoordinate}</th>
                          <th scope="col">{labels.cellType}</th>
                          <th scope="col">{labels.numberFormat}</th>
                          <th scope="col">{labels.formulaCache}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(workbookFor(row)?.cells ?? []).map((cell, index) => (
                          <tr key={`${row.id}-cell-${cell.coordinate ?? index}`}>
                            <td>{cell.coordinate ?? ''}</td>
                            <td>{cell.rawType ?? ''}</td>
                            <td>{cell.numberFormat ?? ''}</td>
                            <td>
                              {cell.hasCachedValue === undefined
                                ? labels.notApplicable
                                : cell.hasCachedValue
                                  ? labels.cachedValueAvailable
                                  : labels.cachedValueUnavailable}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </div>
            <div className="review-actions">
              {row.reviewStatus === 'excluded' ? (
                <button type="button" onClick={() => void update(row, 'restore')}>
                  {labels.restore}
                </button>
              ) : (
                <>
                  <button type="button" onClick={() => void update(row, 'mark-reviewed')}>
                    {labels.markReviewed}
                  </button>
                  <button type="button" onClick={() => void update(row, 'exclude')}>
                    {labels.exclude}
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
      {needsAttention === 0 && rows.length > 0 && (
        <button
          className="primary-button"
          type="button"
          onClick={() => router.push(`/${locale}/imports/${statementId}/summary`)}
        >
          {labels.confirm}
        </button>
      )}
      {!rows.length && <p>{labels.empty}</p>}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
