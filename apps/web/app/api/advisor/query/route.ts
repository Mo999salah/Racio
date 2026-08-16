import { advisorQuerySchema } from '@racio/contracts';
import { answerAdvisorQuestion, type AdvisorStrings } from '@racio/advisor';
import type { ClarificationOptionId } from '@racio/advisor';
import { AuthBoundaryError, getUserPreferences, requireSession } from '@racio/auth';
import { messages } from '@racio/i18n';
import { headers } from 'next/headers';
import { database } from '../../../../lib/database';
import { apiError } from '../../../../lib/api-errors';
import { assertSameOrigin } from '../../../../lib/request-security';
import { getAdvisorRateLimiter, getAiRuntime } from '../../../../lib/ai-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const FALLBACKS = {
  unsupported:
    'I could not understand that question. Try asking about your spending, categories, budget, or goals.',
  clarificationMessage: 'Which period should I look at?',
  clarificationThisMonth: 'This month',
  clarificationLastMonth: 'Previous month',
  clarificationLast30: 'Last 30 days',
  clarificationYtd: 'Year to date',
  noData: 'There is no data yet for this question. Import a statement to see results.',
} as const;

function localizedAdvisorStrings(locale: string): AdvisorStrings {
  const table = messages as unknown as Record<string, { advisor?: Record<string, string> }>;
  const advisor = table[locale]?.advisor ?? table.en?.advisor;
  const get = (key: keyof typeof FALLBACKS) => advisor?.[key] ?? FALLBACKS[key];
  const optionIds: ClarificationOptionId[] = ['thisMonth', 'lastMonth', 'last30', 'ytd'];
  const clarificationOptions = Object.fromEntries(
    optionIds.map((id) => {
      const key = `clarification${id.charAt(0).toUpperCase()}${id.slice(1)}`;
      return [id, advisor?.[key] ?? FALLBACKS[key as keyof typeof FALLBACKS]];
    }),
  ) as AdvisorStrings['clarificationOptions'];
  return {
    unsupported: get('unsupported'),
    clarificationMessage: get('clarificationMessage'),
    clarificationOptions,
    noData: get('noData'),
  };
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(await headers());
    const parsed = advisorQuerySchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid advisor question.');
    const preferences = await getUserPreferences(database.db, session.user.id);
    const result = await answerAdvisorQuestion({
      db: database.db,
      userId: session.user.id,
      preferences,
      runtime: getAiRuntime(),
      query: parsed.data,
      rateLimiter: getAdvisorRateLimiter(),
      strings: localizedAdvisorStrings(preferences.locale),
    });
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
