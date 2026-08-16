import { sanitizeSpreadsheetText } from './sanitize';

/**
 * Deterministic RFC-4180-style CSV encoding.
 *
 * - UTF-8 with a BOM so Excel renders Arabic and Turkish correctly.
 * - CRLF line endings for broad spreadsheet compatibility.
 * - Quoting only when required (comma, quote, CR, LF).
 * - All exported text cells pass through the formula-injection sanitizer.
 */

export const CSV_UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf]);
export const CSV_LINE_ENDING = '\r\n';

export function escapeCsvField(value: string): string {
  const sanitized = sanitizeSpreadsheetText(value);
  if (/[",\r\n]/u.test(sanitized)) return `"${sanitized.replace(/"/gu, '""')}"`;
  return sanitized;
}

export function csvRecord(fields: string[]): string {
  return `${fields.map(escapeCsvField).join(',')}${CSV_LINE_ENDING}`;
}

const textEncoder = new TextEncoder();

export function encodeCsvRecord(fields: string[]): Uint8Array {
  return textEncoder.encode(csvRecord(fields));
}

export function buildCsv(rows: string[][], headers: string[]): Uint8Array {
  const chunks: Uint8Array[] = [CSV_UTF8_BOM];
  chunks.push(encodeCsvRecord(headers));
  for (const row of rows) chunks.push(encodeCsvRecord(row));
  const total = chunks.reduce((size, chunk) => size + chunk.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
