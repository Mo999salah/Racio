import { financialAccountCreateSchema, includeArchivedSchema } from '@racio/contracts';
import {
  AuthBoundaryError,
  createFinancialAccount,
  listFinancialAccounts,
  requireSession,
} from '@racio/auth';
import { headers } from 'next/headers';
import { database } from '../../../lib/database';
import { apiError } from '../../../lib/api-errors';
import { assertSameOrigin } from '../../../lib/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const session = await requireSession(await headers());
    const parsedQuery = includeArchivedSchema.safeParse(
      new URL(request.url).searchParams.get('includeArchived') ?? 'false',
    );
    if (!parsedQuery.success) throw new AuthBoundaryError('VALIDATION', 'Invalid account filter.');
    return Response.json(
      await listFinancialAccounts(database.db, session.user.id, parsedQuery.data === 'true'),
      {
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(await headers());
    const parsed = financialAccountCreateSchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid account values.');
    return Response.json(await createFinancialAccount(database.db, session.user.id, parsed.data), {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
}
