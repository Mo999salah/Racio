import { institutionPatchSchema } from '@racio/contracts';
import { AuthBoundaryError, getInstitution, requireSession, updateInstitution } from '@racio/auth';
import { headers } from 'next/headers';
import { database } from '../../../../lib/database';
import { apiError } from '../../../../lib/api-errors';
import { assertSameOrigin } from '../../../../lib/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession(await headers());
    return Response.json(await getInstitution(database.db, session.user.id, (await params).id), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(await headers());
    const parsed = institutionPatchSchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid institution values.');
    return Response.json(
      await updateInstitution(database.db, session.user.id, (await params).id, parsed.data),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return apiError(error);
  }
}
