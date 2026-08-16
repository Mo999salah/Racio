import { alertRuleCreateSchema, includeArchivedSchema } from '@racio/contracts';
import { AuthBoundaryError, requireSession } from '@racio/auth';
import { createAlertRule, listAlertRules } from '@racio/planning';
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
      throw new AuthBoundaryError('VALIDATION', 'Invalid alert rule filter.');
    const rules = await listAlertRules(
      database.db,
      session.user.id,
      includeArchived.data === 'true',
    );
    return Response.json(rules, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(await headers());
    const parsed = alertRuleCreateSchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid alert rule values.');
    const rule = await createAlertRule(database.db, session.user.id, parsed.data);
    enqueueAlertEvaluation(session.user.id).catch(() => undefined);
    return Response.json(rule, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
