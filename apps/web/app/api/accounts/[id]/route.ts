import { financialAccountActionSchema, financialAccountPatchSchema } from '@racio/contracts';
import {
  AuthBoundaryError,
  archiveFinancialAccount,
  getFinancialAccount,
  requireSession,
  restoreFinancialAccount,
  updateFinancialAccount,
} from '@racio/auth';
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
    return Response.json(
      await getFinancialAccount(database.db, session.user.id, (await params).id),
      {
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(await headers());
    const parsed = financialAccountPatchSchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid account values.');
    return Response.json(
      await updateFinancialAccount(database.db, session.user.id, (await params).id, parsed.data),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(await headers());
    const parsed = financialAccountActionSchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid account action.');
    const accountId = (await params).id;
    const account =
      parsed.data.action === 'archive'
        ? await archiveFinancialAccount(database.db, session.user.id, accountId)
        : await restoreFinancialAccount(database.db, session.user.id, accountId);
    return Response.json(account, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
