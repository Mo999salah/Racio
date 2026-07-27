import { preferencePatchSchema } from '@racio/contracts';
import { getCurrentUserId, requireSession } from '@racio/auth';
import { updateUserPreferences, ensureUserPreferences } from '@racio/auth';
import { database } from '../../../lib/database';
import { apiError } from '../../../lib/api-errors';
import { headers } from 'next/headers';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const requestHeaders = await headers();
    const userId = await getCurrentUserId(requestHeaders);
    return Response.json(await ensureUserPreferences(database.db, userId));
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const requestHeaders = await headers();
    const session = await requireSession(requestHeaders);
    const parsed = preferencePatchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        { error: { code: 'VALIDATION', message: 'Invalid preference values.' } },
        { status: 400 },
      );
    }
    return Response.json(await updateUserPreferences(database.db, session.user.id, parsed.data));
  } catch (error) {
    return apiError(error);
  }
}
