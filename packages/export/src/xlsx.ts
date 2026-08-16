import { strToU8, zipSync } from 'fflate';
import { sanitizeSpreadsheetText } from './sanitize';

/**
 * Minimal OOXML workbook writer.
 *
 * - Only static cells are emitted: text is written as explicit inline strings
 *   and numbers as plain numeric cells. There are no formulas, macros,
 *   external links, charts, shared strings, or executable parts, so the
 *   workbook is safe by construction for spreadsheet consumers.
 * - Monetary truth is exported in the `amount_exact` text cell containing the
 *   canonical decimal string. A separate `amount_numeric` convenience column
 *   is marked non-authoritative because Excel stores IEEE-754 doubles.
 * - Workbook properties carry only generic application metadata; no user
 *   names or email addresses are written.
 */

export type XlsxCell = string | number;
export type XlsxSheet = {
  name: string;
  columns: string[];
  rows: XlsxCell[][];
};

const MAX_COLUMN_WIDTH = 60;
const MAX_ROW_COUNT = 1_048_576;

function xmlEscape(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&apos;');
}

function columnLetter(index: number): string {
  let result = '';
  let value = index + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function cellReference(row: number, column: number): string {
  return `${columnLetter(column)}${row + 1}`;
}

function worksheetXml(sheet: XlsxSheet): string {
  const totalRows = sheet.rows.length + 1;
  const columnCount = sheet.columns.length;
  if (totalRows > MAX_ROW_COUNT) {
    throw new Error('XLSX_ROW_LIMIT_EXCEEDED');
  }
  const columns = sheet.columns
    .map(
      (name, index) =>
        `<col min="${index + 1}" max="${index + 1}" width="${Math.min(
          Math.max(name.length + 4, 10),
          MAX_COLUMN_WIDTH,
        )}" customWidth="1"/>`,
    )
    .join('');
  const rangeEnd = cellReference(Math.max(totalRows - 1, 0), Math.max(columnCount - 1, 0));
  const headerCells = sheet.columns
    .map(
      (name, column) =>
        `<c r="${cellReference(0, column)}" t="inlineStr" s="1"><is><t xml:space="preserve">${xmlEscape(
          sanitizeSpreadsheetText(name),
        )}</t></is></c>`,
    )
    .join('');
  const bodyRows = sheet.rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, columnIndex) => {
          if (typeof cell === 'number') {
            if (!Number.isFinite(cell))
              return `<c r="${cellReference(rowIndex + 1, columnIndex)}"/>`;
            return `<c r="${cellReference(rowIndex + 1, columnIndex)}" s="2"><v>${cell}</v></c>`;
          }
          return `<c r="${cellReference(
            rowIndex + 1,
            columnIndex,
          )}" t="inlineStr" s="1"><is><t xml:space="preserve">${xmlEscape(
            sanitizeSpreadsheetText(cell),
          )}</t></is></c>`;
        })
        .join('');
      return `<row r="${rowIndex + 2}">${cells}</row>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${columns}</cols>
<sheetData><row r="1">${headerCells}</row>${bodyRows}</sheetData>
<autoFilter ref="A1:${rangeEnd}"/>
</worksheet>`;
}

export function buildXlsx(sheets: XlsxSheet[]): Uint8Array {
  if (sheets.length === 0 || sheets.length > 3) throw new Error('XLSX_SHEET_LIMIT_EXCEEDED');
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets
  .map(
    (_, index) =>
      `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  )
  .join('\n')}
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

  const rootRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets
    .map(
      (sheet, index) =>
        `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join('')}</sheets>
</workbook>`;

  const workbookRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets
  .map(
    (_, index) =>
      `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
  )
  .join('\n')}
<Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf/></cellStyleXfs>
<cellXfs count="3"><xf xfId="0"/><xf xfId="0" applyFont="1" fontId="1"/><xf xfId="0"/></cellXfs>
</styleSheet>`;

  const coreProperties = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>Racio export</dc:title>
<dc:creator>Racio</dc:creator>
<dc:description>Exported financial data. Generated by Racio.</dc:description>
<cp:contentStatus></cp:contentStatus>
</cp:coreProperties>`;

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rootRelationships),
    'docProps/core.xml': strToU8(coreProperties),
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8(workbookRelationships),
    'xl/styles.xml': strToU8(styles),
  };
  for (const [index, sheet] of sheets.entries()) {
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(worksheetXml(sheet));
  }
  return zipSync(files, { level: 6, mtime: new Date(Date.UTC(2000, 0, 1)) });
}
