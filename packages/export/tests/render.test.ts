import { describe, expect, it } from 'vitest';
import {
  SPLIT_CSV_COLUMNS,
  SPLIT_XLSX_COLUMNS,
  TRANSACTION_CSV_COLUMNS,
  TRANSACTION_XLSX_COLUMNS,
  splitToCsvFields,
  transactionToCsvFields,
  transactionToXlsxRow,
} from '../src/render';
import type { SplitExportRow, TransactionExportRow } from '../src/queries';

const row: TransactionExportRow = {
  id: 'tx-1',
  bookingDate: '2026-08-16',
  valueDate: '2026-08-17',
  description: 'Market',
  importedDescription: 'market',
  amountExact: '1234.567890',
  currency: 'TRY',
  direction: 'debit',
  account: 'Checking',
  institution: 'Bank',
  merchant: 'Supermarket',
  primaryCategory: 'Groceries',
  secondaryCategories: ['Food'],
  tags: ['weekly'],
  reviewed: true,
  sourceType: 'csv',
  bankTransactionId: 'B-1',
  internalTransferStatus: 'confirmed',
  hasSplits: true,
  splitCount: 2,
  note: 'private note',
};

const split: SplitExportRow = {
  transactionId: 'tx-1',
  position: 0,
  amountExact: '1000',
  currency: 'TRY',
  description: 'Part A',
  note: 'split note',
  primaryCategory: 'Groceries',
  secondaryCategories: [],
  tags: [],
};

describe('transaction export representation', () => {
  it('keeps stable CSV headers without notes', () => {
    expect(TRANSACTION_CSV_COLUMNS).toEqual([
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
    ]);
  });

  it('excludes notes by default and includes them when opted in', () => {
    const withoutNotes = transactionToCsvFields(row, false);
    const withNotes = transactionToCsvFields(row, true);
    expect(withoutNotes).toHaveLength(TRANSACTION_CSV_COLUMNS.length);
    expect(withNotes).toHaveLength(TRANSACTION_CSV_COLUMNS.length + 1);
    expect(withoutNotes).not.toContain('private note');
    expect(withNotes.at(-1)).toBe('private note');
  });

  it('keeps exact decimals and explicit currency', () => {
    const fields = transactionToCsvFields(row, false);
    expect(fields[4]).toBe('1234.567890');
    expect(fields[5]).toBe('TRY');
  });

  it('represents parent rows and splits without flattening', () => {
    const fields = transactionToCsvFields(row, false);
    expect(fields[17]).toBe('true');
    expect(fields[18]).toBe('2');
    expect(fields.length).toBe(19);
    const splitFields = splitToCsvFields(split, false);
    expect(splitFields[0]).toBe('tx-1');
    expect(splitFields[2]).toBe('1000');
    expect(splitFields).toHaveLength(SPLIT_CSV_COLUMNS.length);
  });

  it('keeps confirmed transfer status in the ledger row', () => {
    const fields = transactionToCsvFields(row, false);
    expect(fields[16]).toBe('confirmed');
  });

  it('adds a marked non-authoritative numeric column to XLSX rows', () => {
    const xlsxRow = transactionToXlsxRow(row, false);
    expect(xlsxRow).toHaveLength(TRANSACTION_XLSX_COLUMNS.length);
    expect(TRANSACTION_XLSX_COLUMNS.at(-1)).toBe('amount_numeric_non_authoritative');
    expect(xlsxRow.at(-1)).toBe(1234.56789);
  });
});
