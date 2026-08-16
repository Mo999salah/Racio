import { describe, expect, it } from 'vitest';
import { sanitizeSpreadsheetText } from '../src/sanitize';

describe('spreadsheet formula-injection sanitizer', () => {
  it('escapes all dangerous prefixes', () => {
    expect(sanitizeSpreadsheetText('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
    expect(sanitizeSpreadsheetText('+CMD()')).toBe("'+CMD()");
    expect(sanitizeSpreadsheetText('-CMD()')).toBe("'-CMD()");
    expect(sanitizeSpreadsheetText('@SUM(...)')).toBe("'@SUM(...)");
    expect(sanitizeSpreadsheetText('\t=SUM(A1)')).toBe("'\t=SUM(A1)");
    expect(sanitizeSpreadsheetText('\r=SUM(A1)')).toBe("'\r=SUM(A1)");
  });

  it('does not alter safe values', () => {
    expect(sanitizeSpreadsheetText('Salary')).toBe('Salary');
    expect(sanitizeSpreadsheetText('1234.567890')).toBe('1234.567890');
    expect(sanitizeSpreadsheetText('2026-08-16')).toBe('2026-08-16');
    expect(sanitizeSpreadsheetText('TRY')).toBe('TRY');
    expect(sanitizeSpreadsheetText('debit')).toBe('debit');
    expect(sanitizeSpreadsheetText('true')).toBe('true');
    expect(sanitizeSpreadsheetText('')).toBe('');
  });

  it('preserves unicode text', () => {
    expect(sanitizeSpreadsheetText('سوبر ماركت')).toBe('سوبر ماركت');
    expect(sanitizeSpreadsheetText('Mağaza ödemesi')).toBe('Mağaza ödemesi');
  });

  it('only mutates the exported representation, never the input', () => {
    const input = '=1+1';
    const output = sanitizeSpreadsheetText(input);
    expect(output).toBe("'=1+1");
    expect(input).toBe('=1+1');
  });
});
