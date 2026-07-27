import { historicalAliasApplySchema } from '@racio/contracts';
import { AuthBoundaryError, requireSession } from '@racio/auth';
import { applyHistoricalMerchantAliases } from '@racio/transactions';
import { headers } from 'next/headers';
import { database } from '../../../../lib/database';
import { apiError } from '../../../../lib/api-errors';
import { assertSameOrigin } from '../../../../lib/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(await headers());
    const parsed = historicalAliasApplySchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid alias application.');
    return Response.json(
      await applyHistoricalMerchantAliases(database.db, session.user.id, parsed.data),
    );
  } catch (error) {
    return apiError(error);
  }
}
