import { decimalToScaledInteger, isSafeDecimalString, scaledIntegerToDecimal } from '@racio/domain';

/**
 * Exact scale-6 decimal helpers for the planning boundary. Amounts remain
 * decimal strings; JavaScript `Number` is never financial truth. Percentage
 * values are presentation metadata computed from scaled integers and are
 * never used to mutate amounts.
 */

export function addMoney(left: string, right: string): string {
  return scaledIntegerToDecimal(decimalToScaledInteger(left) + decimalToScaledInteger(right));
}

export function subtractMoney(left: string, right: string): string {
  return scaledIntegerToDecimal(decimalToScaledInteger(left) - decimalToScaledInteger(right));
}

export function isZero(value: string): boolean {
  return decimalToScaledInteger(value) === 0n;
}

export function isNegative(value: string): boolean {
  return decimalToScaledInteger(value) < 0n;
}

export function maxMoney(left: string, right: string): string {
  return decimalToScaledInteger(left) >= decimalToScaledInteger(right) ? left : right;
}

export function isNonNegativeDecimal(value: string): boolean {
  return isSafeDecimalString(value, false);
}

/** Normalise a NUMERIC(20,6) value (e.g. "1250.000000") to canonical decimal text. */
export function normalizeDecimal(value: string): string {
  return scaledIntegerToDecimal(decimalToScaledInteger(value));
}

/**
 * Percentage of `part` over `total` with up to two fractional digits, e.g.
 * `percentOf("12", "20") === "60"` and `percentOf("12450", "20000") === "62.25"`.
 * Returns "0" for a non-positive total. This is presentation metadata only.
 */
export function percentOf(part: string, total: string): string {
  const totalScaled = decimalToScaledInteger(total);
  if (totalScaled <= 0n) return '0';
  const partScaled = decimalToScaledInteger(part);
  const hundredths = (partScaled * 10_000n) / totalScaled;
  const whole = hundredths / 100n;
  const fraction = hundredths % 100n;
  if (fraction === 0n) return `${whole}`;
  const fractionText =
    fraction % 10n === 0n ? `${fraction / 10n}` : fraction.toString().padStart(2, '0');
  return `${whole}.${fractionText}`;
}

/**
 * True when `part` reaches `thresholdPercent` (an integer 0..100) of `total`.
 * Percentage comparisons stay on scaled integers to avoid float drift.
 */
export function percentReached(part: string, total: string, thresholdPercent: number): boolean {
  const totalScaled = decimalToScaledInteger(total);
  if (totalScaled <= 0n) return false;
  const partScaled = decimalToScaledInteger(part);
  return partScaled * 100n >= totalScaled * BigInt(thresholdPercent);
}
