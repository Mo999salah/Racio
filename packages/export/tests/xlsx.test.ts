import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildXlsx, type XlsxSheet } from '../src/xlsx';

function entries(bytes: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(bytes);
}

function xml(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

const sampleSheets: XlsxSheet[] = [
  {
    name: 'Transactions',
    columns: ['booking_date', 'amount_exact', 'currency'],
    rows: [
      ['2026-08-16', '1234.567890', 'TRY'],
      ['2026-08-15', '42', 'USD'],
    ],
  },
  {
    name: 'Metadata',
    columns: ['field', 'value'],
    rows: [['application', 'Racio']],
  },
];

describe('XLSX workbook generation', () => {
  it('builds a valid zip with the expected OOXML parts', () => {
    const bytes = buildXlsx(sampleSheets);
    const files = entries(bytes);
    expect(files['[Content_Types].xml']).toBeTruthy();
    expect(files['_rels/.rels']).toBeTruthy();
    expect(files['xl/workbook.xml']).toBeTruthy();
    expect(files['xl/_rels/workbook.xml.rels']).toBeTruthy();
    expect(files['xl/styles.xml']).toBeTruthy();
    expect(files['xl/worksheets/sheet1.xml']).toBeTruthy();
    expect(files['xl/worksheets/sheet2.xml']).toBeTruthy();
    expect(files['docProps/core.xml']).toBeTruthy();
  });

  it('declares both sheets with stable names', () => {
    const workbook = xml(entries(buildXlsx(sampleSheets))['xl/workbook.xml']!);
    expect(workbook).toContain('name="Transactions"');
    expect(workbook).toContain('name="Metadata"');
    expect(workbook).not.toContain('sheet3');
  });

  it('contains only static cells and no formulas', () => {
    for (const name of ['sheet1', 'sheet2']) {
      const sheetXml = xml(entries(buildXlsx(sampleSheets))[`xl/worksheets/${name}.xml`]!);
      expect(sheetXml).not.toContain('<f>');
      expect(sheetXml).not.toContain('<formula');
      expect(sheetXml).not.toContain('=SUM');
    }
  });

  it('contains no macros, external links, or executable parts', () => {
    const files = entries(buildXlsx(sampleSheets));
    const allXml = Object.values(files)
      .map((value) => xml(value))
      .join('\n');
    expect(allXml.toLowerCase()).not.toContain('vbaproject');
    expect(allXml.toLowerCase()).not.toContain('macros');
    expect(allXml.toLowerCase()).not.toContain('externalLink');
    expect(allXml.toLowerCase()).not.toContain('oleobject');
    expect(allXml.toLowerCase()).not.toContain('activex');
    expect(files['xl/vbaProject.bin']).toBeUndefined();
  });

  it('preserves exact money as text cells and unicode', () => {
    const sheet = xml(entries(buildXlsx(sampleSheets))['xl/worksheets/sheet1.xml']!);
    expect(sheet).toContain('1234.567890');
    expect(sheet).toContain('t="inlineStr"');
    expect(sheet).toContain('TRY');
  });

  it('freezes the header row and adds an autofilter', () => {
    const sheet = xml(entries(buildXlsx(sampleSheets))['xl/worksheets/sheet1.xml']!);
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toContain('topLeftCell="A2"');
    expect(sheet).toContain('<autoFilter ref="A1:C3"/>');
  });

  it('does not leak user-identifying workbook metadata', () => {
    const core = xml(entries(buildXlsx(sampleSheets))['docProps/core.xml']!);
    expect(core).toContain('<dc:creator>Racio</dc:creator>');
    expect(core).not.toContain('user@');
    expect(core).not.toMatch(/lastModifiedBy/i);
    expect(core.toLowerCase()).not.toContain('user');
  });

  it('renders unicode content unescaped and safe', () => {
    const unicodeSheet: XlsxSheet = {
      name: 'Transactions',
      columns: ['description'],
      rows: [['سوبر ماركت', 'Mağaza ödemesi']],
    };
    const sheet = xml(entries(buildXlsx([unicodeSheet]))['xl/worksheets/sheet1.xml']!);
    expect(sheet).toContain('سوبر ماركت');
    expect(sheet).toContain('Mağaza ödemesi');
  });

  it('escapes XML special characters in text cells', () => {
    const specialSheet: XlsxSheet = {
      name: 'Transactions',
      columns: ['description'],
      rows: [['a < b & c > d "quoted"']],
    };
    const sheet = xml(entries(buildXlsx([specialSheet]))['xl/worksheets/sheet1.xml']!);
    expect(sheet).toContain('a &lt; b &amp; c &gt; d &quot;quoted&quot;');
  });

  it('sanitizes text cells that begin with formula prefixes', () => {
    const dangerousSheet: XlsxSheet = {
      name: 'Transactions',
      columns: ['description'],
      rows: [['=SUM(A1:A2)']],
    };
    const sheet = xml(entries(buildXlsx([dangerousSheet]))['xl/worksheets/sheet1.xml']!);
    expect(sheet).toContain('&apos;=SUM(A1:A2)');
  });
});
