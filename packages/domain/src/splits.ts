import { decimalToScaledInteger, scaledIntegerToDecimal } from './index';

export type SplitAmountInput = {
  id?: string;
  position: number;
  amount: string;
  currencyCode: string;
};

export type SplitValidationResult = {
  valid: boolean;
  errors: string[];
  total: string;
  remaining: string;
};

export function validateSplitSet(
  parentAmount: string,
  parentCurrency: string,
  splits: SplitAmountInput[],
  maxSplits = 50,
): SplitValidationResult {
  const errors: string[] = [];
  let parent = 0n;
  try {
    parent = decimalToScaledInteger(parentAmount);
  } catch {
    errors.push('invalid_parent_amount');
  }
  if (splits.length < 1) errors.push('split_required');
  if (splits.length > maxSplits) errors.push('too_many_splits');
  const ids = new Set<string>();
  const positions = new Set<number>();
  let total = 0n;
  for (const split of splits) {
    if (split.id) {
      if (ids.has(split.id)) errors.push('duplicate_split_id');
      ids.add(split.id);
    }
    if (positions.has(split.position)) errors.push('duplicate_split_position');
    positions.add(split.position);
    if (split.currencyCode !== parentCurrency) errors.push('split_currency_mismatch');
    try {
      const amount = decimalToScaledInteger(split.amount);
      if (amount <= 0n) errors.push('split_amount_must_be_positive');
      total += amount;
    } catch {
      errors.push('invalid_split_amount');
    }
  }
  const remaining = parent - total;
  if (remaining < 0n) errors.push('split_total_exceeds_parent');
  if (remaining > 0n) errors.push('split_total_below_parent');
  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    total: scaledIntegerToDecimal(total),
    remaining: scaledIntegerToDecimal(remaining),
  };
}
