import { describe, expect, it } from 'vitest';
import { parseParserResultV2, parsedCsvCandidateSchema } from '../src/index';

describe('CSV import contracts', () => {
  it('accepts parser v2 decimal strings and raw payloads', () => {
    const result = parseParserResultV2({
      contractVersion: 'racio.parser.v2',
      source: {
        filename: 'statement.csv',
        mediaType: 'text/csv',
        encoding: 'utf-8',
        delimiter: ',',
        quoteChar: '"',
        headerRow: 0,
        detectedLanguage: null,
        decimalSeparator: '.',
        thousandsSeparator: null,
        dateFormat: '%Y-%m-%d',
      },
      mapping: {
        status: 'confident',
        columns: {
          headerRow: 0,
          bookingDate: 0,
          valueDate: null,
          description: 1,
          amount: 2,
          debit: null,
          credit: null,
          currency: 3,
          balance: null,
          counterparty: null,
          transactionIdentifier: null,
          decimalSeparator: '.',
          thousandsSeparator: null,
          dateFormat: '%Y-%m-%d',
        },
        confidence: 0.9,
        warnings: [],
      },
      candidates: [
        {
          sourceRow: 2,
          rawPayload: { Date: '2026-01-01' },
          rawDescription: 'Coffee',
          rawBookingDate: '2026-01-01',
          rawValueDate: null,
          rawAmount: '-1.20',
          rawCurrency: 'USD',
          rawBalance: null,
          bookingDate: '2026-01-01',
          valueDate: null,
          amount: '1.2',
          currency: 'USD',
          direction: 'debit',
          balanceAfter: null,
          counterparty: null,
          bankTransactionId: null,
          confidence: 0.9,
          fieldConfidence: { amount: 1 },
          warnings: [],
        },
      ],
      warnings: [],
    });
    expect(result.candidates[0]?.amount).toBe('1.2');
  });

  it('accepts six fractional digits and rejects values outside NUMERIC(20,6)', () => {
    expect(parsedCsvCandidateSchema.shape.amount.parse('0.123456')).toBe('0.123456');
    expect(() => parsedCsvCandidateSchema.shape.amount.parse('0.1234567')).toThrow();
  });
});
