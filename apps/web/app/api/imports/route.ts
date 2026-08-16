import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { importUploadSchema } from '@racio/contracts';
import { AuthBoundaryError, requireSession } from '@racio/auth';
import {
  createCsvImport,
  createPdfImport,
  createXlsxImport,
  listOwnedImports,
} from '@racio/imports';
import { readAppEnv } from '@racio/config';
import { headers } from 'next/headers';
import { database } from '../../../lib/database';
import { getPrivateStorage } from '../../../lib/storage';
import { enqueueImportJob } from '../../../lib/jobs';
import { apiError } from '../../../lib/api-errors';
import { assertSameOrigin } from '../../../lib/request-security';
import { validateStatementUpload } from '../../../lib/import-upload-validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const uploadAttempts = new Map<string, { count: number; resetAt: number }>();

export async function GET(request: Request) {
  try {
    const session = await requireSession(await headers());
    const accountId = new URL(request.url).searchParams.get('accountId');
    if (!accountId) throw new AuthBoundaryError('VALIDATION', 'Account is required.');
    return Response.json(await listOwnedImports(database.db, session.user.id, accountId), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(await headers());
    const now = Date.now();
    const current = uploadAttempts.get(session.user.id);
    if (!current || current.resetAt <= now)
      uploadAttempts.set(session.user.id, { count: 1, resetAt: now + 60_000 });
    else if (current.count >= 12)
      throw new AuthBoundaryError('CONFLICT', 'Upload rate limit reached.');
    else current.count += 1;
    const form = await request.formData();
    const fileEntry = form.get('file');
    if (
      !fileEntry ||
      typeof fileEntry === 'string' ||
      typeof fileEntry.name !== 'string' ||
      typeof fileEntry.size !== 'number' ||
      typeof fileEntry.arrayBuffer !== 'function'
    )
      throw new AuthBoundaryError('VALIDATION', 'A statement file is required.');
    const file = fileEntry;
    const parsed = importUploadSchema.safeParse({
      accountId: form.get('accountId'),
      retainOriginalFile: form.get('retainOriginalFile') === 'true',
      reprocess: form.get('reprocess') === 'true',
      idempotencyKey: form.get('idempotencyKey'),
    });
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid import values.');
    const env = readAppEnv();
    const lowerFilename = file.name.toLowerCase();
    const uploadLimit = lowerFilename.endsWith('.xlsx')
      ? Math.min(env.MAX_UPLOAD_BYTES, env.MAX_XLSX_ARCHIVE_BYTES)
      : lowerFilename.endsWith('.pdf')
        ? Math.min(env.MAX_UPLOAD_BYTES, env.MAX_PDF_UPLOAD_BYTES)
        : env.MAX_UPLOAD_BYTES;
    if (file.size <= 0 || file.size > uploadLimit)
      throw new AuthBoundaryError(
        lowerFilename.endsWith('.xlsx')
          ? 'XLSX_ARCHIVE_LIMIT_EXCEEDED'
          : lowerFilename.endsWith('.pdf')
            ? 'PDF_UPLOAD_LIMIT_EXCEEDED'
            : 'VALIDATION',
        'The uploaded file exceeds the allowed size.',
      );
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sourceType = validateStatementUpload({
      filename: file.name,
      mediaType: file.type,
      bytes,
      maxCsvBytes: env.MAX_UPLOAD_BYTES,
      maxXlsxBytes: Math.min(env.MAX_UPLOAD_BYTES, env.MAX_XLSX_ARCHIVE_BYTES),
      maxPdfBytes: Math.min(env.MAX_UPLOAD_BYTES, env.MAX_PDF_UPLOAD_BYTES),
    });
    const filename =
      basename(file.name)
        .split('')
        .map((character) => {
          const code = character.charCodeAt(0);
          return code < 32 || code === 127 ? '_' : character;
        })
        .join('')
        .slice(0, 240) || `statement.${sourceType}`;
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const createImport =
      sourceType === 'xlsx'
        ? createXlsxImport
        : sourceType === 'pdf'
          ? createPdfImport
          : createCsvImport;
    const result = await createImport(database.db, getPrivateStorage(), session.user.id, {
      ...parsed.data,
      filename,
      size: bytes.byteLength,
      checksum,
      bytes,
    });
    if (result.jobId)
      await enqueueImportJob(
        sourceType === 'xlsx'
          ? 'statement.inspect.xlsx'
          : sourceType === 'pdf'
            ? 'statement.inspect.pdf'
            : 'statement.parse.csv',
        result.jobId,
      );
    return Response.json(result, {
      status: result.duplicate ? 200 : 202,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
}
