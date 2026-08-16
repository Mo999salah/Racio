import { advisorProposalRequestSchema } from '@racio/contracts';
import { createAdvisorProposal } from '@racio/advisor';
import { AuthBoundaryError, getUserPreferences, requireSession } from '@racio/auth';
import { headers } from 'next/headers';
import { database } from '../../../../lib/database';
import { apiError } from '../../../../lib/api-errors';
import { assertSameOrigin } from '../../../../lib/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(await headers());
    const parsed = advisorProposalRequestSchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid advisor proposal.');
    const preferences = await getUserPreferences(database.db, session.user.id);
    const result = await createAdvisorProposal(
      database.db,
      session.user.id,
      parsed.data.proposal,
      preferences.timeZone,
    );
    return Response.json(result, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
