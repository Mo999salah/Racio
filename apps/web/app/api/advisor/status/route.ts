import { getAdvisorStatus } from '@racio/advisor';
import { requireSession } from '@racio/auth';
import { headers } from 'next/headers';
import { getAiRuntime } from '../../../../lib/ai-runtime';
import { apiError } from '../../../../lib/api-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    await requireSession(await headers());
    return Response.json(getAdvisorStatus(getAiRuntime()), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
}
