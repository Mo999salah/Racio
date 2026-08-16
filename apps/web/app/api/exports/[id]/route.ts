import { requireSession } from '@racio/auth';
import { deleteExport, getExportRow, toExportRecord } from '@racio/export';
import { headers } from 'next/headers';
import { database } from '../../../../lib/database';
import { getPrivateStorage } from '../../../../lib/storage';
import { apiError } from '../../../../lib/api-errors';
import { assertSameOrigin } from '../../../../lib/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const session = await requireSession(await headers());
    const { id } = await params;
    const row = await getExportRow(database.db, session.user.id, id);
    return Response.json(toExportRecord(row, new Date()), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(await headers());
    const { id } = await params;
    await deleteExport(database.db, getPrivateStorage(), session.user.id, id);
    return new Response(null, {
      status: 204,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
}
