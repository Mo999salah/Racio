import { importMappingPatchSchema } from '@racio/contracts';
import { and, eq } from 'drizzle-orm';
import { AuthBoundaryError, requireSession } from '@racio/auth';
import { saveImportMapping } from '@racio/imports';
import { schema } from '@racio/database';
import { headers } from 'next/headers';
import { database } from '../../../../../lib/database';
import { enqueueCsvParse } from '../../../../../lib/jobs';
import { apiError } from '../../../../../lib/api-errors';
import { assertSameOrigin } from '../../../../../lib/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(await headers());
    const parsed = importMappingPatchSchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid CSV mapping.');
    const id = (await params).id;
    const statement = await saveImportMapping(
      database.db,
      session.user.id,
      id,
      parsed.data.mapping,
    );
    const [job] = await database.db
      .select({ id: schema.importJobs.id })
      .from(schema.importJobs)
      .where(and(eq(schema.importJobs.statementId, id), eq(schema.importJobs.status, 'queued')))
      .limit(1);
    if (!job) throw new AuthBoundaryError('CONFLICT', 'Import job is not available.');
    await enqueueCsvParse(job.id);
    return Response.json(statement, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
