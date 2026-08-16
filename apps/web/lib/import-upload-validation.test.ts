import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AuthBoundaryError } from '@racio/auth';
import { validateStatementUpload } from './import-upload-validation';

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(new URL(`../../../fixtures/statements/xlsx/${name}`, import.meta.url)),
  );

const limits = { maxCsvBytes: 20_000_000, maxXlsxBytes: 20_000_000, maxPdfBytes: 20_000_000 };

describe('statement upload validation', () => {
  it('accepts a ZIP-signature XLSX for isolated inspection', () => {
    expect(
      validateStatementUpload({
        filename: 'statement.xlsx',
        mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        bytes: fixture('english-one-sheet.xlsx'),
        ...limits,
      }),
    ).toBe('xlsx');
  });

  it.each([
    ['unsupported-legacy.xls', 'XLSX_UNSUPPORTED_LEGACY_EXCEL'],
    ['macro-enabled.xlsm', 'XLSX_MACRO_ENABLED'],
    ['fake-binary.xlsx', 'XLSX_INVALID_WORKBOOK'],
  ])('rejects %s with a stable code', (filename, code) => {
    try {
      validateStatementUpload({
        filename,
        mediaType: 'application/octet-stream',
        bytes: fixture(filename),
        ...limits,
      });
      throw new Error('expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AuthBoundaryError);
      expect((error as AuthBoundaryError).code).toBe(code);
    }
  });

  it('rejects an XLSX over the configured upload limit', () => {
    expect(() =>
      validateStatementUpload({
        filename: 'statement.xlsx',
        mediaType: 'application/octet-stream',
        bytes: fixture('english-one-sheet.xlsx'),
        maxCsvBytes: 20_000_000,
        maxXlsxBytes: 10,
        maxPdfBytes: 20_000_000,
      }),
    ).toThrow();
  });

  it('accepts a %PDF- header and rejects a fake PDF', () => {
    const pdf = new TextEncoder().encode('%PDF-1.4\n%%EOF');
    expect(
      validateStatementUpload({
        filename: 'statement.pdf',
        mediaType: 'application/pdf',
        bytes: pdf,
        ...limits,
      }),
    ).toBe('pdf');
    try {
      validateStatementUpload({
        filename: 'statement.pdf',
        mediaType: 'application/pdf',
        bytes: new TextEncoder().encode('not a pdf at all'),
        ...limits,
      });
      throw new Error('expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AuthBoundaryError);
      expect((error as AuthBoundaryError).code).toBe('PDF_INVALID');
    }
  });

  it('rejects a PDF over the configured upload limit', () => {
    expect(() =>
      validateStatementUpload({
        filename: 'statement.pdf',
        mediaType: 'application/pdf',
        bytes: new TextEncoder().encode('%PDF-1.4'),
        maxCsvBytes: 20_000_000,
        maxXlsxBytes: 20_000_000,
        maxPdfBytes: 4,
      }),
    ).toThrow();
  });
});
