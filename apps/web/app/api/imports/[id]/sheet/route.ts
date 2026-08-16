import { xlsxSheetSelectionSchema } from '@racio/contracts';
import { AuthBoundaryError, ensureUserPreferences, requireSession } from '@racio/auth';
import { selectXlsxSheet } from '@racio/imports';
import { headers } from 'next/headers';
import { database } from '../../../../../lib/database';
import { enqueueImportJob } from '../../../../../lib/jobs';
import { apiError } from '../../../../../lib/api-errors';
import { assertSameOrigin } from '../../../../../lib/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(await headers());
    const parsed = xlsxSheetSelectionSchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid worksheet selection.');
    const preferences = await ensureUserPreferences(database.db, session.user.id);
    const result = await selectXlsxSheet(
      database.db,
      session.user.id,
      (await params).id,
      parsed.data,
      preferences.interfaceMode === 'advanced',
    );
    if (result.jobId) await enqueueImportJob('statement.parse.xlsx', result.jobId);
    return Response.json(result.statement, {
      status: 202,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
}
