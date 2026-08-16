import { exportRequestSchema } from '@racio/contracts';
import { AuthBoundaryError, requireSession } from '@racio/auth';
import { createExportRequest, exportLimitsFromEnv, listExports } from '@racio/export';
import { readAppEnv } from '@racio/config';
import { headers } from 'next/headers';
import { database } from '../../../lib/database';
import { getPrivateStorage } from '../../../lib/storage';
import { apiError } from '../../../lib/api-errors';
import { assertSameOrigin } from '../../../lib/request-security';
import { enqueueExportGenerate } from '../../../lib/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const session = await requireSession(await headers());
    return Response.json(await listExports(database.db, session.user.id, new Date()), {
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
    const body = await request.json();
    const parsed = exportRequestSchema.safeParse(body);
    if (!parsed.success)
      throw new AuthBoundaryError('EXPORT_INVALID_REQUEST', 'Invalid export request.');
    const { record } = await createExportRequest(
      database.db,
      session.user.id,
      parsed.data,
      exportLimitsFromEnv(readAppEnv()),
      getPrivateStorage(),
      new Date(),
      async (exportId) => {
        await enqueueExportGenerate(exportId);
      },
    );
    return Response.json(record, {
      status: 201,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
}
