import { importMappingPatchSchema } from '@racio/contracts';
import { AuthBoundaryError, requireSession } from '@racio/auth';
import { saveImportMapping } from '@racio/imports';
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
    const parsed = importMappingPatchSchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid CSV mapping.');
    const id = (await params).id;
    const result = await saveImportMapping(database.db, session.user.id, id, parsed.data.mapping);
    if (result.jobId)
      await enqueueImportJob(
        'sourceType' in parsed.data.mapping && parsed.data.mapping.sourceType === 'pdf'
          ? 'statement.parse.pdf'
          : 'sourceType' in parsed.data.mapping
            ? 'statement.parse.xlsx'
            : 'statement.parse.csv',
        result.jobId,
      );
    return Response.json(result.statement, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
