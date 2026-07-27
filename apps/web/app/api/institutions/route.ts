import { institutionCreateSchema } from '@racio/contracts';
import {
  AuthBoundaryError,
  createInstitution,
  listInstitutions,
  requireSession,
} from '@racio/auth';
import { headers } from 'next/headers';
import { database } from '../../../lib/database';
import { apiError } from '../../../lib/api-errors';
import { assertSameOrigin } from '../../../lib/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const session = await requireSession(await headers());
    return Response.json(await listInstitutions(database.db, session.user.id), {
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
    const parsed = institutionCreateSchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid institution values.');
    return Response.json(await createInstitution(database.db, session.user.id, parsed.data), {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
}
