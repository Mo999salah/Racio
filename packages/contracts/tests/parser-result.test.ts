import { describe, expect, it } from 'vitest';
import { parseParserResult } from '../src/index';

describe('parser result contract', () => {
  it('accepts decimal strings and rejects numeric amounts', () => {
    const result = parseParserResult({
      contractVersion: 'racio.parser.v1',
      source: { filename: 'statement.csv', mediaType: 'text/csv' },
      candidates: [
        {
          sourceRow: 2,
          rawDescription: 'Grocer',
          amount: '12.50',
          currency: 'EUR',
          direction: 'debit',
          confidence: { overall: 0.9 },
          warnings: [],
        },
      ],
      warnings: [],
    });

    expect(result.candidates[0]?.amount).toBe('12.50');
    expect(() =>
      parseParserResult({
        contractVersion: 'racio.parser.v1',
        source: { filename: 'statement.csv', mediaType: 'text/csv' },
        candidates: [
          { rawDescription: 'Grocer', amount: 12.5, confidence: { overall: 1 }, warnings: [] },
        ],
        warnings: [],
      }),
    ).toThrow();
  });
});
