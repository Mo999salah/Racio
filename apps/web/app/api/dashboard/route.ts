import { dashboardQuerySchema } from '@racio/contracts';
import { AuthBoundaryError, requireSession } from '@racio/auth';
import { getDashboardSummary } from '@racio/transactions';
import { headers } from 'next/headers';
import { database } from '../../../lib/database';
import { apiError } from '../../../lib/api-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const session = await requireSession(await headers());
    const parsed = dashboardQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid dashboard query.');
    return Response.json(await getDashboardSummary(database.db, session.user.id, parsed.data), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
}
