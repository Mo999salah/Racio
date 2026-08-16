import { decimalToScaledInteger, scaledIntegerToDecimal } from '@racio/domain';

/**
 * Exact scale-6 decimal helpers for the advisor boundary. The advisor never
 * uses floating-point money; comparison deltas and percentages are computed
 * with bigint scaled integers and returned as decimal strings.
 */

export function addMoney(left: string, right: string): string {
  return scaledIntegerToDecimal(decimalToScaledInteger(left) + decimalToScaledInteger(right));
}

export function subtractMoney(left: string, right: string): string {
  return scaledIntegerToDecimal(decimalToScaledInteger(left) - decimalToScaledInteger(right));
}

export function isZeroMoney(value: string): boolean {
  return decimalToScaledInteger(value) === 0n;
}

export function moneyGreaterThan(left: string, right: string): boolean {
  return decimalToScaledInteger(left) > decimalToScaledInteger(right);
}

export function moneyLessThan(left: string, right: string): boolean {
  return decimalToScaledInteger(left) < decimalToScaledInteger(right);
}

/** Exact percentage as a decimal string (one decimal), null when total is zero. */
export function percentOf(part: string, total: string): string | null {
  const totalScaled = decimalToScaledInteger(total);
  if (totalScaled <= 0n) return null;
  const partScaled = decimalToScaledInteger(part);
  const tenths = (partScaled * 1000n) / totalScaled;
  const whole = tenths / 10n;
  const fraction = tenths % 10n;
  return fraction > 0n ? `${whole}.${fraction}` : `${whole}`;
}

export type ChangeStatus = 'increased' | 'decreased' | 'same' | 'none';

/**
 * Deterministic comparison of a current value against a previous value.
 * Returns the exact signed change and an optional percentage (null when the
 * previous value is zero). No floating point is involved.
 */
export function compareValues(
  current: string,
  previous: string,
): { change: string; percentage: string | null; status: ChangeStatus } {
  const change = subtractMoney(current, previous);
  const previousScaled = decimalToScaledInteger(previous);
  if (previousScaled === 0n) {
    const status: ChangeStatus = isZeroMoney(change) ? 'same' : 'none';
    return { change, percentage: null, status };
  }
  const changeScaled = decimalToScaledInteger(change);
  const status: ChangeStatus =
    changeScaled > 0n ? 'increased' : changeScaled < 0n ? 'decreased' : 'same';
  // percentage = change / previous * 100, computed as scaled tenths.
  const tenths = (changeScaled * 10_000n) / previousScaled;
  const whole = tenths / 10n;
  const fraction = tenths % 10n;
  const percentage = fraction !== 0n ? `${whole}.${fraction}` : `${whole}`;
  return { change, percentage, status };
}
