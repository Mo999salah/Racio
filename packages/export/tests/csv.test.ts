import { describe, expect, it } from 'vitest';
import { buildCsv, csvRecord, encodeCsvRecord, escapeCsvField } from '../src/csv';
import { sanitizeSpreadsheetText } from '../src/sanitize';

const decoder = new TextDecoder();

describe('CSV encoding', () => {
  it('starts with a UTF-8 BOM and uses CRLF line endings', () => {
    const bytes = buildCsv([['a', 'b']], ['h1', 'h2']);
    expect(bytes[0]).toBe(0xef);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    expect(text.startsWith('\uFEFFh1,h2\r\n')).toBe(true);
    expect(text.endsWith('a,b\r\n')).toBe(true);
    expect(text).not.toContain('\n\r');
  });

  it('quotes fields containing commas, quotes, or newlines', () => {
    expect(csvRecord(['plain', 'a,b', 'say "hi"', 'line\nbreak'])).toBe(
      'plain,"a,b","say ""hi""","line\nbreak"\r\n',
    );
  });

  it('escapes formula-injection prefixes in every field', () => {
    const line = csvRecord(['=SUM(A1:A2)', '+CMD', '-CMD', '@SUM', '\t=1', '\r=1', 'safe']);
    expect(line).toContain("'=SUM(A1:A2)");
    expect(line).toContain("'+CMD");
    expect(line).toContain("'-CMD");
    expect(line).toContain("'@SUM");
    expect(line).toContain("'\t=1");
    expect(line).toContain("'\r=1");
    expect(line).toContain('safe');
  });

  it('preserves exact decimal strings and UTF-8 Arabic/Turkish', () => {
    const line = csvRecord(['1234.567890', 'TRY', 'سوبر ماركت', 'Mağaza']);
    expect(line).toContain('1234.567890');
    expect(line).toContain('سوبر ماركت');
    expect(line).toContain('Mağaza');
    const roundTrip = decoder.decode(encodeCsvRecord(['سوبر ماركت', 'Mağaza']));
    expect(roundTrip).toBe('سوبر ماركت,Mağaza\r\n');
  });

  it('keeps headers stable and unmodified', () => {
    const headers = ['booking_date', 'amount_exact', 'currency'];
    const bytes = buildCsv([], headers);
    const text = decoder.decode(bytes).replace(/^\uFEFF/u, '');
    expect(text).toBe('booking_date,amount_exact,currency\r\n');
  });

  it('encodes empty fields', () => {
    expect(csvRecord(['', 'x'])).toBe(',x\r\n');
  });

  it('handles long descriptions without truncation', () => {
    const long = 'x'.repeat(10_000);
    const line = csvRecord([long]);
    expect(line.length).toBe(long.length + 2);
  });

  it('sanitizer equivalence inside csvRecord', () => {
    const line = csvRecord(['=1+1']);
    expect(line.trim().replace(/\r$/u, '')).toBe(sanitizeSpreadsheetText('=1+1'));
  });
});
