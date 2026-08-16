export type ExportLimits = {
  /** Row threshold below which transaction exports run synchronously. */
  syncMaxRows: number;
  /** Hard cap on exported transaction rows per export. */
  maxRows: number;
  /** Hard cap on generated file bytes. */
  maxFileBytes: number;
  /** Hard cap on archive resource records. */
  maxArchiveRecords: number;
  /** Generated files expire after this many hours. */
  retentionHours: number;
  /** Maximum concurrent preparing exports per user. */
  maxConcurrentPerUser: number;
};

const DEFAULT_LIMITS: ExportLimits = {
  syncMaxRows: 10_000,
  maxRows: 250_000,
  maxFileBytes: 50 * 1024 * 1024,
  maxArchiveRecords: 100_000,
  retentionHours: 24,
  maxConcurrentPerUser: 3,
};

export type ExportLimitsEnv = {
  EXPORT_SYNC_MAX_ROWS: number;
  EXPORT_MAX_ROWS: number;
  EXPORT_MAX_FILE_BYTES: number;
  EXPORT_MAX_ARCHIVE_RECORDS: number;
  EXPORT_RETENTION_HOURS: number;
  EXPORT_MAX_CONCURRENT_PER_USER: number;
};

export function exportLimitsFromEnv(input: ExportLimitsEnv): ExportLimits {
  return {
    syncMaxRows: Math.min(Math.max(input.EXPORT_SYNC_MAX_ROWS, 1), 250_000),
    maxRows: Math.min(Math.max(input.EXPORT_MAX_ROWS, 1), 1_000_000),
    maxFileBytes: Math.min(Math.max(input.EXPORT_MAX_FILE_BYTES, 1), 500 * 1024 * 1024),
    maxArchiveRecords: Math.min(Math.max(input.EXPORT_MAX_ARCHIVE_RECORDS, 1), 500_000),
    retentionHours: Math.min(Math.max(input.EXPORT_RETENTION_HOURS, 1), 720),
    maxConcurrentPerUser: Math.min(Math.max(input.EXPORT_MAX_CONCURRENT_PER_USER, 1), 20),
  };
}

export const DEFAULT_EXPORT_LIMITS: ExportLimits = DEFAULT_LIMITS;
