import { describe, expect, it } from 'vitest';
import {
  normalizeTransactionDescription,
  reconcileStatement,
  validateImportCandidate,
} from '../src/index';

describe('import domain rules', () => {
  it('normalizes descriptions deterministically', () => {
    expect(normalizeTransactionDescription('  Coffee\u0000   SHOP ')).toBe('coffee shop');
  });

  it('reconciles exact zero-, two-, three-, and six-decimal values', () => {
    expect(
      reconcileStatement({
        openingBalance: '0',
        closingBalance: '0.123456',
        credits: '0.123456',
        debits: '0',
        tolerance: '0.000001',
      }),
    ).toMatchObject({ status: 'matched', difference: '0', expectedClosing: '0.123456' });
    expect(
      reconcileStatement({
        openingBalance: '100.00',
        closingBalance: '150.00',
        credits: '75.00',
        debits: '25.00',
        tolerance: '0.000001',
      }),
    ).toMatchObject({ status: 'matched', difference: '0', expectedClosing: '150' });
    expect(
      reconcileStatement({
        openingBalance: '0',
        closingBalance: '12.345',
        credits: '12.345',
        debits: '0',
        tolerance: '0.000001',
      }),
    ).toMatchObject({ status: 'matched', difference: '0', expectedClosing: '12.345' });
    expect(
      reconcileStatement({
        openingBalance: '100.00',
        closingBalance: '151.00',
        credits: '75.00',
        debits: '25.00',
        tolerance: '0.000001',
      }).status,
    ).toBe('mismatch');
  });

  it('rejects more than six fractional digits instead of rounding', () => {
    expect(
      reconcileStatement({
        openingBalance: '0',
        closingBalance: '0.1234567',
        credits: '0.1234567',
        debits: '0',
        tolerance: '0.000001',
      }).status,
    ).toBe('unverifiable');
  });

  it('reports missing fields without coercing money', () => {
    expect(validateImportCandidate({ amount: '1.2' })).toContain('missing_booking_date');
    expect(validateImportCandidate({ amount: '1,2' })).toContain('invalid_amount');
  });
});
