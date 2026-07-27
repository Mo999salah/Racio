import { importConfirmSchema } from '@racio/contracts';
import { AuthBoundaryError, requireSession } from '@racio/auth';
import { confirmImport } from '@racio/imports';
import { headers } from 'next/headers';
import { database } from '../../../../../lib/database';
import { privateStorage } from '../../../../../lib/storage';
import { apiError } from '../../../../../lib/api-errors';
import { assertSameOrigin } from '../../../../../lib/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(await headers());
    const parsed = importConfirmSchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid confirmation.');
    return Response.json(
      await confirmImport(
        database.db,
        privateStorage,
        session.user.id,
        (await params).id,
        parsed.data.confirmMismatch,
        parsed.data.idempotencyKey,
      ),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return apiError(error);
  }
}
