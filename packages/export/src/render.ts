import type { SplitExportRow, TransactionExportRow } from './queries';
import type { XlsxSheet } from './xlsx';

/**
 * Transaction export representation.
 *
 * One row per banking transaction (the parent row). Splits never flatten
 * into duplicate transaction rows: the parent carries `has_splits` and
 * `split_count`, and active split allocations are exported as a separate
 * sheet/file that is never additive with the parent without labeling.
 * Confirmed internal transfers are exported as ordinary ledger rows with
 * their transfer status. Every monetary value is a canonical decimal string
 * in the `amount_exact` column plus an explicit `currency` column.
 */

export const TRANSACTION_CSV_COLUMNS = [
  'booking_date',
  'value_date',
  'description',
  'imported_description',
  'amount_exact',
  'currency',
  'direction',
  'account',
  'institution',
  'merchant',
  'primary_category',
  'secondary_categories',
  'tags',
  'reviewed',
  'source_type',
  'bank_transaction_id',
  'internal_transfer_status',
  'has_splits',
  'split_count',
] as const;

export const TRANSACTION_CSV_COLUMNS_WITH_NOTES = [...TRANSACTION_CSV_COLUMNS, 'note'] as const;

/** XLSX adds a clearly marked non-authoritative numeric convenience column. */
export const TRANSACTION_XLSX_COLUMNS = [
  ...TRANSACTION_CSV_COLUMNS,
  'amount_numeric_non_authoritative',
] as const;

export const TRANSACTION_XLSX_COLUMNS_WITH_NOTES = [...TRANSACTION_XLSX_COLUMNS, 'note'] as const;

export const SPLIT_CSV_COLUMNS = [
  'transaction_export_key',
  'split_position',
  'amount_exact',
  'currency',
  'description',
  'primary_category',
  'secondary_categories',
  'tags',
] as const;

export const SPLIT_CSV_COLUMNS_WITH_NOTES = [...SPLIT_CSV_COLUMNS, 'note'] as const;

export const SPLIT_XLSX_COLUMNS = [
  ...SPLIT_CSV_COLUMNS,
  'amount_numeric_non_authoritative',
] as const;

export const SPLIT_XLSX_COLUMNS_WITH_NOTES = [...SPLIT_XLSX_COLUMNS, 'note'] as const;

function joinNames(values: string[]): string {
  return values.filter((value) => value.length > 0).join('; ');
}

export function transactionToCsvFields(row: TransactionExportRow, includeNotes: boolean): string[] {
  const fields = [
    row.bookingDate,
    row.valueDate ?? '',
    row.description,
    row.importedDescription,
    row.amountExact,
    row.currency,
    row.direction,
    row.account,
    row.institution,
    row.merchant,
    row.primaryCategory,
    joinNames(row.secondaryCategories),
    joinNames(row.tags),
    row.reviewed ? 'true' : 'false',
    row.sourceType,
    row.bankTransactionId ?? '',
    row.internalTransferStatus,
    row.hasSplits ? 'true' : 'false',
    String(row.splitCount),
  ];
  if (includeNotes) fields.push(row.note ?? '');
  return fields;
}

export function transactionToXlsxRow(
  row: TransactionExportRow,
  includeNotes: boolean,
): Array<string | number> {
  const fields: Array<string | number> = transactionToCsvFields(row, includeNotes);
  fields.push(Number(row.amountExact));
  return fields;
}

export function splitToCsvFields(split: SplitExportRow, includeNotes: boolean): string[] {
  const fields = [
    split.transactionId,
    String(split.position),
    split.amountExact,
    split.currency,
    split.description,
    split.primaryCategory,
    joinNames(split.secondaryCategories),
    joinNames(split.tags),
  ];
  if (includeNotes) fields.push(split.note ?? '');
  return fields;
}

export function splitToXlsxRow(
  split: SplitExportRow,
  includeNotes: boolean,
): Array<string | number> {
  const fields: Array<string | number> = splitToCsvFields(split, includeNotes);
  fields.push(Number(split.amountExact));
  return fields;
}

export function buildTransactionsXlsxSheets(input: {
  rows: TransactionExportRow[];
  splits: SplitExportRow[];
  includeNotes: boolean;
  includeSplits: boolean;
  locale: string;
  timezone: string;
  rowCount: number;
  generatedAt: string;
}): XlsxSheet[] {
  const transactionColumns = input.includeNotes
    ? TRANSACTION_XLSX_COLUMNS_WITH_NOTES
    : TRANSACTION_XLSX_COLUMNS;
  const splitColumns = input.includeNotes ? SPLIT_XLSX_COLUMNS_WITH_NOTES : SPLIT_XLSX_COLUMNS;
  const sheets: XlsxSheet[] = [
    {
      name: 'Transactions',
      columns: [...transactionColumns],
      rows: input.rows.map((row) => transactionToXlsxRow(row, input.includeNotes)),
    },
  ];
  if (input.includeSplits) {
    sheets.push({
      name: 'Splits',
      columns: [...splitColumns],
      rows: input.splits.map((split) => splitToXlsxRow(split, input.includeNotes)),
    });
  }
  sheets.push({
    name: 'Metadata',
    columns: ['field', 'value'],
    rows: [
      ['application', 'Racio'],
      ['format', 'transactions_xlsx'],
      ['generated_at', input.generatedAt],
      ['locale', input.locale],
      ['timezone', input.timezone],
      ['row_count', String(input.rowCount)],
      ['amount_exact', 'Authoritative canonical decimal strings (text cells).'],
      [
        'amount_numeric_non_authoritative',
        'Excel IEEE-754 convenience values; not financial truth.',
      ],
      [
        'splits',
        input.includeSplits ? 'Active split allocations are in the Splits sheet.' : 'Not included.',
      ],
      ['notes', input.includeNotes ? 'Included.' : 'Excluded by default.'],
    ],
  });
  return sheets;
}
