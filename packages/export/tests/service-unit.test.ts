import { describe, expect, it } from 'vitest';
import { exportLimitsFromEnv, type ExportLimitsEnv } from '../src/limits';
import { exportFileName, exportFileSpec, isExportExpired, toExportRecord } from '../src/service';
import type { ExportRow } from '../src/service';

const env: ExportLimitsEnv = {
  EXPORT_SYNC_MAX_ROWS: 10_000,
  EXPORT_MAX_ROWS: 250_000,
  EXPORT_MAX_FILE_BYTES: 50 * 1024 * 1024,
  EXPORT_MAX_ARCHIVE_RECORDS: 100_000,
  EXPORT_RETENTION_HOURS: 24,
  EXPORT_MAX_CONCURRENT_PER_USER: 3,
};

describe('export limits', () => {
  it('clamps out-of-range environment values', () => {
    const limits = exportLimitsFromEnv({
      ...env,
      EXPORT_MAX_ROWS: 9_999_999,
      EXPORT_SYNC_MAX_ROWS: 0,
      EXPORT_RETENTION_HOURS: 9_999,
    });
    expect(limits.maxRows).toBe(1_000_000);
    expect(limits.syncMaxRows).toBe(1);
    expect(limits.retentionHours).toBe(720);
  });

  it('keeps valid values as configured', () => {
    expect(exportLimitsFromEnv(env)).toEqual({
      syncMaxRows: 10_000,
      maxRows: 250_000,
      maxFileBytes: 50 * 1024 * 1024,
      maxArchiveRecords: 100_000,
      retentionHours: 24,
      maxConcurrentPerUser: 3,
    });
  });
});

describe('export file naming', () => {
  it('produces deterministic safe filenames without user content', () => {
    expect(exportFileName('transactions_csv', new Date('2026-08-16T10:00:00Z'))).toBe(
      'racio-transactions-2026-08-16.csv',
    );
    expect(exportFileName('transactions_xlsx', new Date('2026-08-16T10:00:00Z'))).toBe(
      'racio-transactions-2026-08-16.xlsx',
    );
    expect(exportFileName('account_archive', new Date('2026-08-16T10:00:00Z'))).toBe(
      'racio-archive-2026-08-16.zip',
    );
  });

  it('uses safe content types per format', () => {
    expect(exportFileSpec('transactions_csv').contentType).toBe('text/csv; charset=utf-8');
    expect(exportFileSpec('transactions_xlsx').contentType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(exportFileSpec('account_archive').contentType).toBe('application/zip');
  });
});

describe('export expiry', () => {
  const base: ExportRow = {
    id: 'e1',
    userId: 'u1',
    type: 'transactions_csv',
    status: 'ready',
    requestJson: { type: 'transactions_csv', filters: {}, includeNotes: false },
    storageKey: 'exports/e1.csv',
    sizeBytes: 10,
    checksum: 'a'.repeat(64),
    rowCount: 1,
    errorCode: null,
    createdAt: new Date('2026-08-16T10:00:00Z'),
    completedAt: new Date('2026-08-16T10:00:00Z'),
    expiresAt: new Date('2026-08-17T10:00:00Z'),
    updatedAt: new Date('2026-08-16T10:00:00Z'),
  };

  it('expires only ready exports past their expiry', () => {
    expect(isExportExpired(base, new Date('2026-08-17T10:00:00Z'))).toBe(true);
    expect(isExportExpired(base, new Date('2026-08-17T09:59:59Z'))).toBe(false);
    expect(
      isExportExpired(
        { ...base, status: 'preparing', expiresAt: new Date('2020-01-01Z') },
        new Date(),
      ),
    ).toBe(false);
    expect(isExportExpired({ ...base, expiresAt: null }, new Date('2030-01-01Z'))).toBe(false);
  });

  it('renders records with computed expired state and stable file names', () => {
    const record = toExportRecord(base, new Date('2026-08-17T10:00:00Z'));
    expect(record.expired).toBe(true);
    expect(record.fileName).toBe('racio-transactions-2026-08-16.csv');
    expect(record.checksum).toBe('a'.repeat(64));
    expect(record.status).toBe('ready');
    expect(record.createdAt).toBe('2026-08-16T10:00:00.000Z');
  });
});
