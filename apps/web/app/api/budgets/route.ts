import { budgetCreateSchema, includeArchivedSchema } from '@racio/contracts';
import { AuthBoundaryError, getUserPreferences, requireSession } from '@racio/auth';
import { createBudget, listBudgetsWithStatus } from '@racio/planning';
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
    const includeArchived = includeArchivedSchema.safeParse(
      new URL(request.url).searchParams.get('includeArchived') ?? 'false',
    );
    if (!includeArchived.success)
      throw new AuthBoundaryError('VALIDATION', 'Invalid budget filter.');
    const preferences = await getUserPreferences(database.db, session.user.id);
    const budgets = await listBudgetsWithStatus(
      database.db,
      session.user.id,
      preferences.timeZone,
      includeArchived.data === 'true',
    );
    return Response.json(budgets, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(await headers());
    const parsed = budgetCreateSchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid budget values.');
    const budget = await createBudget(database.db, session.user.id, parsed.data);
    enqueueAlertEvaluation(session.user.id).catch(() => undefined);
    return Response.json(budget, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
