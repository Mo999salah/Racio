import { requireSession } from '@racio/auth';
import { previewMerchantAliases } from '@racio/transactions';
import { headers } from 'next/headers';
import { database } from '../../../../lib/database';
import { apiError } from '../../../../lib/api-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const session = await requireSession(await headers());
    return Response.json(await previewMerchantAliases(database.db, session.user.id), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
}
