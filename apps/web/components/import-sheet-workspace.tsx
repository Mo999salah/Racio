'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Sheet = {
  id: string;
  name: string;
  index: number;
  hidden: boolean;
  veryHidden: boolean;
  estimatedRows: number;
  estimatedColumns: number;
  populatedCells: number;
  mergedRangeCount: number;
  formulaCellCount: number;
  sampleRows: string[][];
  warnings: string[];
};

export function ImportSheetWorkspace({
  statementId,
  locale,
  sheets,
  advanced,
  labels,
}: {
  statementId: string;
  locale: string;
  sheets: Sheet[];
  advanced: boolean;
  labels: Record<string, string>;
}) {
  const router = useRouter();
  const [busySheet, setBusySheet] = useState('');
  const [error, setError] = useState('');
  const availableSheets = sheets.filter((sheet) => advanced || !sheet.hidden);

  async function selectSheet(sheet: Sheet) {
    setBusySheet(sheet.id);
    setError('');
    const response = await fetch(`/api/imports/${statementId}/sheet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sheetId: sheet.id,
        sheetIndex: sheet.index,
        sheetName: sheet.name,
      }),
    });
    if (!response.ok) {
      setError(labels.error ?? '');
      setBusySheet('');
      return;
    }
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const statusResponse = await fetch(`/api/imports/${statementId}`, {
        cache: 'no-store',
      });
      const status = (await statusResponse.json().catch(() => null)) as {
        processingStatus?: string;
        lastErrorCode?: string;
      } | null;
      if (status?.processingStatus === 'needs_mapping') {
        router.push(`/${locale}/imports/${statementId}/mapping`);
        return;
      }
      if (status?.processingStatus === 'needs_review' || status?.processingStatus === 'ready') {
        router.push(`/${locale}/imports/${statementId}/review`);
        return;
      }
      if (status?.processingStatus === 'failed') {
        setError(
          status.lastErrorCode && labels[`error_${status.lastErrorCode}`]
            ? (labels[`error_${status.lastErrorCode}`] ?? labels.error ?? '')
            : (labels.error ?? ''),
        );
        setBusySheet('');
        return;
      }
    }
    setError(labels.timeout ?? labels.error ?? '');
    setBusySheet('');
  }

  return (
    <div className="sheet-selector">
      <p className="status-note">{labels.sheetSelectionDescription}</p>
      <div className="sheet-list">
        {availableSheets.map((sheet) => {
          const headers = sheet.sampleRows[0] ?? [];
          const sampleBody = sheet.sampleRows.slice(1);
          const unavailable = sheet.veryHidden || sheet.populatedCells === 0;
          return (
            <section className="sheet-record" key={sheet.id} aria-labelledby={`${sheet.id}-title`}>
              <div className="sheet-record-heading">
                <div>
                  <h2 id={`${sheet.id}-title`}>{sheet.name}</h2>
                  <p>
                    {sheet.hidden ? labels.hiddenSheet : labels.visibleSheet}
                    {sheet.veryHidden ? ` · ${labels.veryHiddenSheet}` : ''}
                  </p>
                </div>
                <button
                  className="primary-button"
                  type="button"
                  disabled={Boolean(busySheet) || unavailable}
                  aria-describedby={`${sheet.id}-details`}
                  onClick={() => void selectSheet(sheet)}
                >
                  {busySheet === sheet.id ? labels.busy : labels.selectSheet}
                </button>
              </div>
              <dl className="sheet-metadata" id={`${sheet.id}-details`}>
                <div>
                  <dt>{labels.estimatedRows}</dt>
                  <dd>{sheet.estimatedRows}</dd>
                </div>
                <div>
                  <dt>{labels.estimatedColumns}</dt>
                  <dd>{sheet.estimatedColumns}</dd>
                </div>
                {advanced && (
                  <>
                    <div>
                      <dt>{labels.populatedCells}</dt>
                      <dd>{sheet.populatedCells}</dd>
                    </div>
                    <div>
                      <dt>{labels.formulaCount}</dt>
                      <dd>{sheet.formulaCellCount}</dd>
                    </div>
                    <div>
                      <dt>{labels.mergedRangeCount}</dt>
                      <dd>{sheet.mergedRangeCount}</dd>
                    </div>
                    <div>
                      <dt>{labels.sheetIndex}</dt>
                      <dd>{sheet.index}</dd>
                    </div>
                  </>
                )}
              </dl>
              {sheet.warnings.length > 0 && (
                <div className="workbook-warning" role="status">
                  <strong>{labels.warnings}</strong>
                  <ul>
                    {sheet.warnings.map((warning) => (
                      <li key={warning}>
                        {labels[`warning_${warning}`] ?? labels.workbookWarning}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {headers.length > 0 && (
                <div className="sample-table-scroll" tabIndex={0}>
                  <table className="sample-table">
                    <caption>{labels.sampleRows}</caption>
                    <thead>
                      <tr>
                        {headers.map((header, index) => (
                          <th scope="col" key={`${sheet.id}-header-${index}`}>
                            {header || `${labels.column} ${index + 1}`}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sampleBody.map((row, rowIndex) => (
                        <tr key={`${sheet.id}-row-${rowIndex}`}>
                          {headers.map((_header, columnIndex) => (
                            <td key={`${sheet.id}-${rowIndex}-${columnIndex}`}>
                              {row[columnIndex] ?? ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}
      </div>
      {!availableSheets.length && <p>{labels.noUsableSheet}</p>}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
