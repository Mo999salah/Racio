import { describe, expect, it } from 'vitest';
import {
  confirmImport,
  createCsvImport,
  getImportReview,
  getOwnedStatement,
  listOwnedImports,
  processCsvParseJob,
  saveImportMapping,
  updateRawTransaction,
} from '../src/index';

describe('import application boundary', () => {
  it('exports import workflow services outside the auth package', () => {
    expect(
      [
        createCsvImport,
        getOwnedStatement,
        listOwnedImports,
        saveImportMapping,
        getImportReview,
        updateRawTransaction,
        confirmImport,
        processCsvParseJob,
      ].every((service) => typeof service === 'function'),
    ).toBe(true);
  });
});
