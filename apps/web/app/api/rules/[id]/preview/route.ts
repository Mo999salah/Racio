import { rulePreviewRequestSchema } from '@racio/contracts';
import { AuthBoundaryError, requireSession } from '@racio/auth';
import { previewRule } from '@racio/transactions';
import { headers } from 'next/headers';
import { database } from '../../../../../lib/database';
import { apiError } from '../../../../../lib/api-errors';
import { assertSameOrigin } from '../../../../../lib/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(await headers());
    const parsed = rulePreviewRequestSchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid preview request.');
    return Response.json(await previewRule(database.db, session.user.id, (await params).id));
  } catch (error) {
    return apiError(error);
  }
}
