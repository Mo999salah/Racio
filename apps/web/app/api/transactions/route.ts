import { transactionListQuerySchema } from '@racio/contracts';
import { AuthBoundaryError, requireSession } from '@racio/auth';
import { listTransactions, bulkUpdateTransactions } from '@racio/transactions';
import { headers } from 'next/headers';
import { database } from '../../../lib/database';
import { apiError } from '../../../lib/api-errors';
import { assertSameOrigin } from '../../../lib/request-security';
import { enqueueAlertEvaluation } from '../../../lib/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const session = await requireSession(await headers());
    const parsed = transactionListQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid transaction filters.');
    return Response.json(await listTransactions(database.db, session.user.id, parsed.data), {
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
    const body = await request.json();
    const parsed = (await import('@racio/contracts')).transactionBulkActionSchema.safeParse(body);
    if (!parsed.success)
      throw new AuthBoundaryError('VALIDATION', 'Invalid bulk transaction action.');
    const result = await bulkUpdateTransactions(database.db, session.user.id, parsed.data);
    enqueueAlertEvaluation(session.user.id).catch(() => undefined);
    return Response.json(result);
  } catch (error) {
    return apiError(error);
  }
}
