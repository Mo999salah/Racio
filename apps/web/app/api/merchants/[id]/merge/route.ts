import { merchantMergeSchema } from '@racio/contracts';
import { AuthBoundaryError, requireSession } from '@racio/auth';
import { mergeMerchants } from '@racio/transactions';
import { headers } from 'next/headers';
import { database } from '../../../../../lib/database';
import { apiError } from '../../../../../lib/api-errors';
import { assertSameOrigin } from '../../../../../lib/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(await headers());
    const parsed = merchantMergeSchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid merchant merge.');
    return Response.json(
      await mergeMerchants(
        database.db,
        session.user.id,
        (await params).id,
        parsed.data.targetMerchantId,
      ),
    );
  } catch (error) {
    return apiError(error);
  }
}
