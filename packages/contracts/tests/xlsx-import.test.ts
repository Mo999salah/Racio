import { describe, expect, it } from 'vitest';
import { parseWorkbookInspection, parseXlsxParserResult, xlsxMappingSchema } from '../src/index';

const mapping = {
  sourceType: 'xlsx' as const,
  selectedSheetId: 'sheet-0',
  selectedSheetName: 'Statement',
  selectedSheetIndex: 0,
  headerRow: 1,
  firstDataRow: 2,
  lastDataRow: 2,
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
  columnLetters: { bookingDate: 'A', description: 'B', amount: 'C', currency: 'D' },
};

describe('XLSX import contracts', () => {
  it('accepts a bounded workbook inspection without internal paths', () => {
    const inspection = parseWorkbookInspection({
      contractVersion: 'racio.workbook-inspection.v1',
      workbookType: 'xlsx',
      sheetCount: 1,
      dateSystem: '1900',
      sheets: [
        {
          id: 'sheet-0',
          name: 'Statement',
          index: 0,
          hidden: false,
          veryHidden: false,
          estimatedRows: 2,
          estimatedColumns: 4,
          populatedCells: 8,
          mergedRangeCount: 0,
          formulaCellCount: 0,
          sampleRows: [['Date', 'Description', 'Amount', 'Currency']],
          warnings: [],
        },
      ],
      workbookWarnings: [],
    });
    expect(inspection.sheets[0]?.name).toBe('Statement');
    expect(inspection).not.toHaveProperty('storageKey');
  });

  it('uses one shared neutral candidate with bounded XLSX raw cells', () => {
    const result = parseXlsxParserResult({
      contractVersion: 'racio.parser.v2',
      source: {
        sourceType: 'xlsx',
        filename: 'statement.xlsx',
        mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        sheetName: 'Statement',
        sheetIndex: 0,
        headerRow: 1,
        firstDataRow: 2,
        lastDataRow: 2,
        workbookDateSystem: '1900',
        formulaCellCount: 0,
        mergedRangeCount: 0,
        detectedLanguage: null,
      },
      mapping: { status: 'confident', columns: mapping, confidence: 0.92, warnings: [] },
      candidates: [
        {
          sourceRow: 2,
          rawPayload: { 'A:Date': '2026-01-01' },
          rawDescription: 'Market',
          rawBookingDate: '2026-01-01',
          rawValueDate: null,
          rawAmount: '-12.34',
          rawCurrency: 'USD',
          rawBalance: null,
          bookingDate: '2026-01-01',
          valueDate: null,
          amount: '12.34',
          currency: 'USD',
          direction: 'debit',
          balanceAfter: null,
          counterparty: null,
          bankTransactionId: null,
          confidence: 1,
          fieldConfidence: { amount: 1 },
          warnings: [],
          rawCells: [
            {
              row: 2,
              column: 3,
              coordinate: 'C2',
              displayedText: '-12.34',
              rawType: 'number',
              rawValue: '-12.34',
              numberFormat: '0.00',
              formula: null,
              hasCachedValue: null,
            },
          ],
        },
      ],
      warnings: [],
    });
    expect(result.candidates[0]?.amount).toBe('12.34');
    expect(result.candidates[0]?.rawCells[0]?.coordinate).toBe('C2');
  });

  it('rejects stale or incomplete sheet mapping metadata', () => {
    expect(() => xlsxMappingSchema.parse({ ...mapping, selectedSheetName: '' })).toThrow();
    expect(() => xlsxMappingSchema.parse({ ...mapping, firstDataRow: 0 })).toThrow();
  });
});
