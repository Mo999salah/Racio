import type { AdvisorDateRange } from '@racio/contracts';

/**
 * Fact model for the advisor. Facts are validated structured values produced
 * by deterministic tools; monetary facts stay decimal strings. The model may
 * reference a fact only through {{fact:<id>}} placeholders, which the server
 * renders with the exact value, so the model can never introduce a monetary
 * figure of its own.
 */

export type FactValue =
  | { kind: 'money'; amount: string; currency: string }
  | { kind: 'number'; value: number }
  | { kind: 'text'; value: string };

export type Drilldown = { kind: string; href: string };

export type AdvisorFact = {
  id: string;
  tool: string;
  label: string;
  value: FactValue;
  drilldown?: Drilldown;
};

export type FactMap = Map<string, AdvisorFact>;

export function formatAmountForLocale(amount: string, locale: string): string {
  const negative = amount.startsWith('-');
  const absolute = negative ? amount.slice(1) : amount;
  const [whole = '0', fraction = ''] = absolute.split('.');
  const grouped = new Intl.NumberFormat(locale).format(Number(whole) || 0);
  const fractionText = fraction && /[1-9]/u.test(fraction) ? `.${fraction}` : '';
  return `${negative ? '-' : ''}${grouped}${fractionText}`;
}

export function formatFactValue(fact: AdvisorFact, locale: string): string {
  switch (fact.value.kind) {
    case 'money':
      return `${formatAmountForLocale(fact.value.amount, locale)} ${fact.value.currency}`;
    case 'number':
      return new Intl.NumberFormat(locale).format(fact.value.value);
    case 'text':
      return fact.value.value;
  }
}

/** Compact, data-only line for the provider prompt. Values are included so the
 * model can reason about magnitude, but it must reference them via placeholders. */
export function factLineForPrompt(fact: AdvisorFact): string {
  switch (fact.value.kind) {
    case 'money':
      return `${fact.id}: ${fact.label} = ${fact.value.amount} ${fact.value.currency}`;
    case 'number':
      return `${fact.id}: ${fact.label} = ${fact.value.value}`;
    case 'text':
      return `${fact.id}: ${fact.label} = "${fact.value.value}"`;
  }
}

const PLACEHOLDER = /\{\{fact:(\d+)\}\}/gu;

export function citedFactIds(text: string): string[] {
  const ids: string[] = [];
  for (const match of text.matchAll(PLACEHOLDER)) {
    ids.push(`fact-${match[1]}`);
  }
  return ids;
}

export function validateExplanation(
  text: string,
  citedFacts: string[],
  facts: FactMap,
): { ok: true } | { ok: false; reason: string } {
  if (!text || text.length > 6_000) return { ok: false, reason: 'text-length' };
  const placeholders = citedFactIds(text);
  const referenced = [...new Set([...placeholders, ...citedFacts])];
  if (referenced.length === 0) return { ok: false, reason: 'no-facts-cited' };
  for (const id of referenced) {
    if (!facts.has(id)) return { ok: false, reason: `unknown-fact:${id}` };
  }
  return { ok: true };
}

/** Renders {{fact:<id>}} placeholders with exact server-side values. */
export function renderAnswer(text: string, facts: FactMap, locale: string): string {
  return text.replace(PLACEHOLDER, (_match, index: string) => {
    const fact = facts.get(`fact-${index}`);
    return fact ? formatFactValue(fact, locale) : '';
  });
}

export type LedgerDrilldownParams = {
  dateRange?: AdvisorDateRange;
  currency?: string;
  accountId?: string;
  categoryId?: string;
  search?: string;
};

export function transactionsDrilldown(locale: string, params: LedgerDrilldownParams): Drilldown {
  const query = new URLSearchParams();
  if (params.dateRange) {
    query.set('dateFrom', params.dateRange.from);
    query.set('dateTo', params.dateRange.to);
  }
  if (params.currency) query.set('currency', params.currency);
  if (params.accountId) query.set('accountId', params.accountId);
  if (params.categoryId) query.set('primaryCategoryId', params.categoryId);
  if (params.search) query.set('search', params.search);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return { kind: 'transactions', href: `/${locale}/transactions${suffix}` };
}

export function budgetsDrilldown(locale: string): Drilldown {
  return { kind: 'budgets', href: `/${locale}/budgets` };
}

export function goalsDrilldown(locale: string): Drilldown {
  return { kind: 'goals', href: `/${locale}/goals` };
}

export function alertsDrilldown(locale: string): Drilldown {
  return { kind: 'alerts', href: `/${locale}/alerts` };
}

export function reconciliationDrilldown(locale: string): Drilldown {
  return { kind: 'reconciliation', href: `/${locale}/imports` };
}

export function importsDrilldown(locale: string): Drilldown {
  return { kind: 'imports', href: `/${locale}/imports/new` };
}
