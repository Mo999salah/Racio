import { transactionMerchantPatchSchema } from '@racio/contracts';
import { AuthBoundaryError, requireSession } from '@racio/auth';
import { setTransactionMerchant } from '@racio/transactions';
import { headers } from 'next/headers';
import { database } from '../../../../../lib/database';
import { apiError } from '../../../../../lib/api-errors';
import { assertSameOrigin } from '../../../../../lib/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(await headers());
    const parsed = transactionMerchantPatchSchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid merchant assignment.');
    return Response.json(
      await setTransactionMerchant(database.db, session.user.id, (await params).id, parsed.data),
    );
  } catch (error) {
    return apiError(error);
  }
}
