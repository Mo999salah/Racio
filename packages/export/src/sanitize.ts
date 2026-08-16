/**
 * Spreadsheet formula-injection defense.
 *
 * Text values beginning with a spreadsheet-command prefix are escaped by
 * prefixing an apostrophe. This is applied only to the exported
 * representation; authoritative stored data is never mutated. Numbers, ISO
 * dates, and currency codes never begin with a dangerous prefix, so the
 * sanitizer does not alter them (verified by tests).
 */

const DANGEROUS_PREFIX = /^(?:[=+\-@\t\r])/u;

export function sanitizeSpreadsheetText(value: string): string {
  if (DANGEROUS_PREFIX.test(value)) return `'${value}`;
  return value;
}
