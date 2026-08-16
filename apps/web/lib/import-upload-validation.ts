import { AuthBoundaryError } from '@racio/auth';

export type StatementUploadType = 'csv' | 'xlsx' | 'pdf';

export function validateStatementUpload(input: {
  filename: string;
  mediaType: string;
  bytes: Uint8Array;
  maxCsvBytes: number;
  maxXlsxBytes: number;
  maxPdfBytes: number;
}): StatementUploadType {
  const lowerName = input.filename.toLowerCase();
  if (lowerName.endsWith('.xls'))
    throw new AuthBoundaryError('XLSX_UNSUPPORTED_LEGACY_EXCEL', 'Legacy Excel is unsupported.');
  if (lowerName.endsWith('.xlsm'))
    throw new AuthBoundaryError('XLSX_MACRO_ENABLED', 'Macro-enabled workbooks are unsupported.');
  const sourceType = lowerName.endsWith('.xlsx')
    ? 'xlsx'
    : lowerName.endsWith('.csv')
      ? 'csv'
      : lowerName.endsWith('.pdf')
        ? 'pdf'
        : null;
  if (!sourceType)
    throw new AuthBoundaryError('VALIDATION', 'Only CSV, XLSX, and PDF statements are accepted.');
  const limit =
    sourceType === 'xlsx'
      ? input.maxXlsxBytes
      : sourceType === 'pdf'
        ? input.maxPdfBytes
        : input.maxCsvBytes;
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > limit)
    throw new AuthBoundaryError(
      sourceType === 'xlsx'
        ? 'XLSX_ARCHIVE_LIMIT_EXCEEDED'
        : sourceType === 'pdf'
          ? 'PDF_UPLOAD_LIMIT_EXCEEDED'
          : 'VALIDATION',
      'The statement file is too large or empty.',
    );
  if (sourceType === 'xlsx') {
    if (
      input.bytes[0] !== 0x50 ||
      input.bytes[1] !== 0x4b ||
      input.bytes[2] !== 0x03 ||
      input.bytes[3] !== 0x04
    )
      throw new AuthBoundaryError('XLSX_INVALID_WORKBOOK', 'The workbook container is invalid.');
    return sourceType;
  }
  if (sourceType === 'pdf') {
    const header = new TextDecoder().decode(input.bytes.slice(0, 8));
    if (!header.startsWith('%PDF-'))
      throw new AuthBoundaryError('PDF_INVALID', 'The PDF header is invalid.');
    return sourceType;
  }

  const signature = new TextDecoder().decode(input.bytes.slice(0, 4096));
  const binaryMime = new Set([
    'application/pdf',
    'application/zip',
    'application/x-7z-compressed',
    'application/vnd.ms-excel',
  ]);
  if (binaryMime.has(input.mediaType) || input.bytes.includes(0) || !/[;,\t]/u.test(signature))
    throw new AuthBoundaryError('VALIDATION', 'Only safe CSV files are accepted.');
  return sourceType;
}
