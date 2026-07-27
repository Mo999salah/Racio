import { transactionSplitsReplaceSchema } from '@racio/contracts';
import { AuthBoundaryError, requireSession } from '@racio/auth';
import { getTransactionSplits, replaceTransactionSplits } from '@racio/transactions';
import { headers } from 'next/headers';
import { database } from '../../../../../lib/database';
import { apiError } from '../../../../../lib/api-errors';
import { assertSameOrigin } from '../../../../../lib/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession(await headers());
    return Response.json(
      await getTransactionSplits(database.db, session.user.id, (await params).id),
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(await headers());
    const parsed = transactionSplitsReplaceSchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid split definition.');
    return Response.json(
      await replaceTransactionSplits(
        database.db,
        session.user.id,
        (await params).id,
        parsed.data.splits,
      ),
    );
  } catch (error) {
    return apiError(error);
  }
}
