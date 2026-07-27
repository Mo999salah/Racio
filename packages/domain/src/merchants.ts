export type MerchantAliasMatchType =
  | 'exact_normalized_description'
  | 'normalized_description_contains'
  | 'normalized_description_starts_with'
  | 'exact_counterparty'
  | 'counterparty_contains';

export function normalizeMerchantName(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/[|_:;/]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase('en-US');
}

export function merchantAliasMatches(
  description: string,
  counterparty: string | null | undefined,
  pattern: string,
  matchType: MerchantAliasMatchType,
): boolean {
  const normalizedDescription = normalizeMerchantName(description);
  const normalizedCounterparty = normalizeMerchantName(counterparty ?? '');
  const normalizedPattern = normalizeMerchantName(pattern);
  if (!normalizedPattern) return false;
  if (matchType === 'exact_normalized_description')
    return normalizedDescription === normalizedPattern;
  if (matchType === 'normalized_description_contains')
    return normalizedDescription.includes(normalizedPattern);
  if (matchType === 'normalized_description_starts_with')
    return normalizedDescription.startsWith(normalizedPattern);
  if (matchType === 'exact_counterparty') return normalizedCounterparty === normalizedPattern;
  return normalizedCounterparty.includes(normalizedPattern);
}
