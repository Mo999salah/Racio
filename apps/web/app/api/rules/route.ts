import { classificationRuleCreateSchema, includeArchivedSchema } from '@racio/contracts';
import { AuthBoundaryError, requireSession } from '@racio/auth';
import { createRule, listRules } from '@racio/transactions';
import { headers } from 'next/headers';
import { database } from '../../../lib/database';
import { apiError } from '../../../lib/api-errors';
import { assertSameOrigin } from '../../../lib/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireSession(await headers());
    const parsed = includeArchivedSchema.safeParse(
      new URL(request.url).searchParams.get('includeArchived') ?? 'false',
    );
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid rule filter.');
    return Response.json(await listRules(database.db, session.user.id, parsed.data === 'true'), {
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
    const parsed = classificationRuleCreateSchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid rule values.');
    return Response.json(await createRule(database.db, session.user.id, parsed.data), {
      status: 201,
    });
  } catch (error) {
    return apiError(error);
  }
}
