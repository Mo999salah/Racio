import { budgetActionSchema, budgetPatchSchema } from '@racio/contracts';
import { AuthBoundaryError, getUserPreferences, requireSession } from '@racio/auth';
import { actionBudget, getBudgetStatus, updateBudget } from '@racio/planning';
import { headers } from 'next/headers';
import { database } from '../../../../lib/database';
import { apiError } from '../../../../lib/api-errors';
import { assertSameOrigin } from '../../../../lib/request-security';
import { enqueueAlertEvaluation } from '../../../../lib/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession(await headers());
    const preferences = await getUserPreferences(database.db, session.user.id);
    const status = await getBudgetStatus(
      database.db,
      session.user.id,
      (await params).id,
      preferences.timeZone,
    );
    return Response.json(status, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(await headers());
    const parsed = budgetPatchSchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid budget values.');
    const result = await updateBudget(database.db, session.user.id, (await params).id, parsed.data);
    enqueueAlertEvaluation(session.user.id).catch(() => undefined);
    return Response.json(result);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(await headers());
    const parsed = budgetActionSchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid budget action.');
    const result = await actionBudget(
      database.db,
      session.user.id,
      (await params).id,
      parsed.data.action,
    );
    enqueueAlertEvaluation(session.user.id).catch(() => undefined);
    return Response.json(result);
  } catch (error) {
    return apiError(error);
  }
}
