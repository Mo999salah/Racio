import { describe, expect, it } from 'vitest';
import {
  confirmImport,
  createCsvImport,
  createXlsxImport,
  getImportReview,
  getOwnedStatement,
  listOwnedImports,
  processCsvParseJob,
  processXlsxInspectionJob,
  processXlsxParseJob,
  saveImportMapping,
  selectXlsxSheet,
  updateRawTransaction,
} from '../src/index';

describe('import application boundary', () => {
  it('exports import workflow services outside the auth package', () => {
    expect(
      [
        createCsvImport,
        createXlsxImport,
        getOwnedStatement,
        listOwnedImports,
        saveImportMapping,
        getImportReview,
        updateRawTransaction,
        confirmImport,
        processCsvParseJob,
        processXlsxInspectionJob,
        processXlsxParseJob,
        selectXlsxSheet,
      ].every((service) => typeof service === 'function'),
    ).toBe(true);
  });
});
