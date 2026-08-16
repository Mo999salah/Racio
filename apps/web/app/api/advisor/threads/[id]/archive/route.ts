import { archiveThread } from '@racio/advisor';
import { requireSession } from '@racio/auth';
import { headers } from 'next/headers';
import { database } from '../../../../../../lib/database';
import { apiError } from '../../../../../../lib/api-errors';
import { assertSameOrigin } from '../../../../../../lib/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(await headers());
    await archiveThread(database.db, session.user.id, (await params).id);
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
