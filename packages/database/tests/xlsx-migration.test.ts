import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readMigration(tag: string): string {
  return readFileSync(new URL(`../drizzle/${tag}.sql`, import.meta.url), 'utf8');
}

describe('Phase 7 migration', () => {
  it('extends the shared statement tables without creating parallel XLSX tables', () => {
    const sql = readMigration('0007_lively_katie_power');
    expect(sql).toContain(`statement_source_type" ADD VALUE 'xlsx'`);
    expect(sql).toContain(`statement_processing_status" ADD VALUE 'inspecting'`);
    expect(sql).toContain(`statement_processing_status" ADD VALUE 'needs_sheet_selection'`);
    expect(sql).toContain(`ADD COLUMN "workbook_inspection" jsonb`);
    expect(sql).toContain(`ADD COLUMN "source_metadata" jsonb`);
    expect(sql).not.toMatch(/CREATE TABLE/iu);
  });

  it('does not re-declare the (id, user_id) unique constraints that earlier migrations own', () => {
    const sql = readMigration('0007_lively_katie_power');
    expect(sql).not.toContain('financial_accounts_id_user_id_unique');
    expect(sql).not.toContain('raw_transactions_id_user_id_unique');
    expect(sql).not.toContain('transaction_splits_id_user_id_unique');
  });
});

describe('migration chain ownership ordering', () => {
  it('declares the (id, user_id) uniques in the migration where their first composite FK appears', () => {
    const m0001 = readMigration('0001_yielding_adam_destine');
    expect(m0001).toContain('financial_accounts_id_user_id_unique');

    const m0002 = readMigration('0002_late_preak');
    expect(m0002).toContain('raw_transactions_id_user_id_unique');
    expect(m0002).toContain('transactions_id_user_id_unique');

    const m0004 = readMigration('0004_fixed_lockjaw');
    expect(m0004).not.toContain('transactions_id_user_id_unique');

    const m0006 = readMigration('0006_flaky_scourge');
    expect(m0006).toContain('transaction_splits_id_user_id_unique');
  });

  it('introduces the transactions (id, user_id) unique before any composite FK references it', () => {
    const m0002 = readMigration('0002_late_preak');
    const uniqueLine = m0002.indexOf('transactions_id_user_id_unique');
    const rawFkLine = m0002.indexOf('transactions_owner_raw_fk');
    expect(uniqueLine).toBeGreaterThan(-1);
    expect(rawFkLine).toBeGreaterThan(-1);
    expect(uniqueLine).toBeLessThan(rawFkLine);
  });
});
