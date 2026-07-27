import { categoryCreateSchema, includeArchivedSchema } from '@racio/contracts';
import { AuthBoundaryError, requireSession } from '@racio/auth';
import { createCategory, listCategories, seedDefaultCategories } from '@racio/transactions';
import { headers } from 'next/headers';
import { database } from '../../../lib/database';
import { apiError } from '../../../lib/api-errors';
import { assertSameOrigin } from '../../../lib/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireSession(await headers());
    const includeArchived = includeArchivedSchema.safeParse(
      new URL(request.url).searchParams.get('includeArchived') ?? 'false',
    );
    if (!includeArchived.success)
      throw new AuthBoundaryError('VALIDATION', 'Invalid category filter.');
    const categories = await listCategories(
      database.db,
      session.user.id,
      includeArchived.data === 'true',
    );
    if (!categories.length)
      await seedDefaultCategories(
        database.db,
        session.user.id,
        new URL(request.url).searchParams.get('locale') ?? 'en',
      );
    return Response.json(
      categories.length ? categories : await listCategories(database.db, session.user.id, false),
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(await headers());
    const parsed = categoryCreateSchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid category values.');
    return Response.json(await createCategory(database.db, session.user.id, parsed.data), {
      status: 201,
    });
  } catch (error) {
    return apiError(error);
  }
}
