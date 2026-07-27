import { manualTransferLinkSchema, transferListQuerySchema } from '@racio/contracts';
import { AuthBoundaryError, requireSession } from '@racio/auth';
import { createManualTransferLink, listInternalTransfers } from '@racio/transactions';
import { headers } from 'next/headers';
import { database } from '../../../lib/database';
import { apiError } from '../../../lib/api-errors';
import { assertSameOrigin } from '../../../lib/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireSession(await headers());
    const query = Object.fromEntries(new URL(request.url).searchParams.entries());
    const parsed = transferListQuerySchema.safeParse(query);
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid transfer filters.');
    return Response.json(await listInternalTransfers(database.db, session.user.id, parsed.data), {
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
    const parsed = manualTransferLinkSchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid transfer link.');
    return Response.json(
      await createManualTransferLink(database.db, session.user.id, parsed.data),
      {
        status: 201,
      },
    );
  } catch (error) {
    return apiError(error);
  }
}
