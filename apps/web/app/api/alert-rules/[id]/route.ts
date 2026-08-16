import { alertRuleActionSchema, alertRulePatchSchema } from '@racio/contracts';
import { AuthBoundaryError, requireSession } from '@racio/auth';
import { actionAlertRule, updateAlertRule } from '@racio/planning';
import { headers } from 'next/headers';
import { database } from '../../../../lib/database';
import { apiError } from '../../../../lib/api-errors';
import { assertSameOrigin } from '../../../../lib/request-security';
import { enqueueAlertEvaluation } from '../../../../lib/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(await headers());
    const parsed = alertRulePatchSchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid alert rule values.');
    const result = await updateAlertRule(
      database.db,
      session.user.id,
      (await params).id,
      parsed.data,
    );
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
    const parsed = alertRuleActionSchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid alert rule action.');
    const result = await actionAlertRule(
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
