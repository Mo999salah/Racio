import { classificationRulePatchSchema, ruleActionRequestSchema } from '@racio/contracts';
import { AuthBoundaryError, requireSession } from '@racio/auth';
import { ruleAction, updateRule } from '@racio/transactions';
import { headers } from 'next/headers';
import { database } from '../../../../lib/database';
import { apiError } from '../../../../lib/api-errors';
import { assertSameOrigin } from '../../../../lib/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(await headers());
    const parsed = classificationRulePatchSchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid rule values.');
    return Response.json(
      await updateRule(database.db, session.user.id, (await params).id, parsed.data),
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(await headers());
    const parsed = ruleActionRequestSchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid rule action.');
    return Response.json(
      await ruleAction(database.db, session.user.id, (await params).id, parsed.data.action),
    );
  } catch (error) {
    return apiError(error);
  }
}
