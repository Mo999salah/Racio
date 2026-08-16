import { z } from 'zod';
import { ADVISOR_REPAIR_PROMPT, ADVISOR_SYSTEM_PROMPT, AiError, type AiRuntime } from '@racio/ai';
import { factLineForPrompt, validateExplanation, type AdvisorFact, type FactMap } from './facts';

const MAX_FACTS_IN_PROMPT = 40;
const MAX_FACT_LABEL = 160;
const MAX_FACT_TEXT_VALUE = 200;

const advisorExplanationSchema = z
  .object({
    text: z.string().min(1).max(6_000),
    citedFacts: z.array(z.string().min(1).max(40)).max(40),
  })
  .strict();

export type AdvisorExplanation = { text: string; citedFacts: string[] };

function promptLine(fact: AdvisorFact): string {
  const label = fact.label.slice(0, MAX_FACT_LABEL);
  let line = factLineForPrompt({ ...fact, label });
  if (fact.value.kind === 'text') {
    line = `${fact.id}: ${label} = "${String(fact.value.value).slice(0, MAX_FACT_TEXT_VALUE)}"`;
  }
  return line;
}

function buildUserPrompt(question: string, facts: AdvisorFact[]): string {
  const lines = facts.slice(0, MAX_FACTS_IN_PROMPT).map(promptLine);
  return [
    `Question from the user:\n${question}`,
    '',
    'Verified facts (computed by deterministic Racio data services):',
    ...lines,
    '',
    'Rules for your answer:',
    '- Reference every monetary value ONLY through a {{fact:<id>}} placeholder; never type an amount yourself.',
    '- Only cite facts from the list above. Never invent ids, entities, or figures.',
    '- Answer in the user\u2019s language.',
  ].join('\n');
}

/**
 * Calls the provider with a bounded repair retry and validates its structured
 * output against the explanation schema and the available facts. The model
 * cannot bypass validation: invalid JSON, unknown fact ids, and unknown
 * placeholders are rejected before anything is shown to the user.
 */
export async function generateExplanation(
  runtime: AiRuntime,
  question: string,
  facts: AdvisorFact[],
  factsById: FactMap,
): Promise<AdvisorExplanation> {
  if (runtime.availability !== 'available' || !runtime.provider) throw new AiError('AI_DISABLED');

  const user = buildUserPrompt(question, facts);
  const maxRetries = runtime.config.maxRetries;
  let lastReason = 'invalid';

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const system =
      attempt === 0
        ? ADVISOR_SYSTEM_PROMPT
        : `${ADVISOR_SYSTEM_PROMPT}\n\n${ADVISOR_REPAIR_PROMPT}`;
    const response = await runtime.provider.generateStructured({
      system,
      user,
      maxOutputTokens: runtime.config.maxOutputTokens,
    });
    const parsed = advisorExplanationSchema.safeParse(response.structured);
    if (!parsed.success) {
      lastReason = 'schema';
      continue;
    }
    const validation = validateExplanation(parsed.data.text, parsed.data.citedFacts, factsById);
    if (!validation.ok) {
      lastReason = validation.reason;
      continue;
    }
    return { text: parsed.data.text, citedFacts: parsed.data.citedFacts };
  }
  throw new AiError(
    'AI_RESPONSE_INVALID',
    `The advisor could not produce a valid answer (${lastReason}).`,
  );
}
