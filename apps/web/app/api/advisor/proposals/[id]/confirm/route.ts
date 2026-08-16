import { advisorConfirmSchema } from '@racio/contracts';
import { confirmAdvisorProposal } from '@racio/advisor';
import { AuthBoundaryError, requireSession } from '@racio/auth';
import { headers } from 'next/headers';
import { database } from '../../../../../../lib/database';
import { apiError } from '../../../../../../lib/api-errors';
import { assertSameOrigin } from '../../../../../../lib/request-security';
import { enqueueAlertEvaluation } from '../../../../../../lib/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(await headers());
    const parsed = advisorConfirmSchema.safeParse(await request.json());
    if (!parsed.success)
      throw new AuthBoundaryError('VALIDATION', 'Invalid proposal confirmation.');
    const result = await confirmAdvisorProposal(
      database.db,
      session.user.id,
      parsed.data.proposalId,
    );
    if (result.needsAlertEvaluation) enqueueAlertEvaluation(session.user.id).catch(() => undefined);
    return Response.json(result);
  } catch (error) {
    return apiError(error);
  }
}
