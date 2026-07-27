import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { importUploadSchema } from '@racio/contracts';
import { AuthBoundaryError, requireSession } from '@racio/auth';
import { createCsvImport, listOwnedImports } from '@racio/imports';
import { readAppEnv } from '@racio/config';
import { headers } from 'next/headers';
import { database } from '../../../lib/database';
import { privateStorage } from '../../../lib/storage';
import { enqueueCsvParse } from '../../../lib/jobs';
import { apiError } from '../../../lib/api-errors';
import { assertSameOrigin } from '../../../lib/request-security';

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
    const file = form.get('file');
    if (!(file instanceof File)) throw new AuthBoundaryError('VALIDATION', 'CSV file is required.');
    const parsed = importUploadSchema.safeParse({
      accountId: form.get('accountId'),
      retainOriginalFile: form.get('retainOriginalFile') === 'true',
      reprocess: form.get('reprocess') === 'true',
      idempotencyKey: form.get('idempotencyKey'),
    });
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid import values.');
    const env = readAppEnv();
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > env.MAX_UPLOAD_BYTES)
      throw new AuthBoundaryError('VALIDATION', 'CSV file is too large or empty.');
    const signature = new TextDecoder().decode(bytes.slice(0, 4096));
    const binaryMime = new Set([
      'application/pdf',
      'application/zip',
      'application/x-7z-compressed',
      'application/vnd.ms-excel',
    ]);
    if (
      !file.name.toLowerCase().endsWith('.csv') ||
      binaryMime.has(file.type) ||
      bytes.includes(0) ||
      !/[;,\t]/u.test(signature)
    )
      throw new AuthBoundaryError('VALIDATION', 'Only safe CSV files are accepted.');
    const filename =
      basename(file.name)
        .split('')
        .map((character) => {
          const code = character.charCodeAt(0);
          return code < 32 || code === 127 ? '_' : character;
        })
        .join('')
        .slice(0, 240) || 'statement.csv';
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const result = await createCsvImport(database.db, privateStorage, session.user.id, {
      ...parsed.data,
      filename,
      size: bytes.byteLength,
      checksum,
      bytes,
    });
    if (result.jobId) await enqueueCsvParse(result.jobId);
    return Response.json(result, {
      status: result.duplicate ? 200 : 202,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
}
