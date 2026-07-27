import { tagActionSchema, tagPatchSchema } from '@racio/contracts';
import { AuthBoundaryError, requireSession } from '@racio/auth';
import { archiveTag, restoreTag, updateTag } from '@racio/transactions';
import { headers } from 'next/headers';
import { database } from '../../../../lib/database';
import { apiError } from '../../../../lib/api-errors';
import { assertSameOrigin } from '../../../../lib/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(await headers());
    const parsed = tagPatchSchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid tag values.');
    return Response.json(
      await updateTag(database.db, session.user.id, (await params).id, parsed.data),
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(await headers());
    const parsed = tagActionSchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid tag action.');
    const id = (await params).id;
    return Response.json(
      parsed.data.action === 'archive'
        ? await archiveTag(database.db, session.user.id, id)
        : await restoreTag(database.db, session.user.id, id),
    );
  } catch (error) {
    return apiError(error);
  }
}
