/**
 * Deterministic financial-domain boundary.
 *
 * Keep calculation modules free of ORM and AI imports. Money operations must
 * use a decimal implementation and explicit currency parameters. This package
 * intentionally contains no production financial behaviour in Phase 1.
 */
export type CurrencyCode = string;

export type DecimalAmount = {
  value: string;
  currency: CurrencyCode;
};

export const MONEY_SCALE = 6;
export const MONEY_SCALE_FACTOR = 1_000_000n;
export const MINIMUM_MONEY_UNIT = '0.000001';

const DECIMAL_STRING_PATTERN = /^-?\d{1,14}(?:\.\d{1,6})?$/u;

export function isSafeDecimalString(value: string, allowNegative = true): boolean {
  if (!allowNegative && value.startsWith('-')) return false;
  return DECIMAL_STRING_PATTERN.test(value);
}

/** Parse NUMERIC(20,6) text without using Number or rounding. */
export function decimalToScaledInteger(value: string): bigint {
  const normalized = value.trim();
  if (!isSafeDecimalString(normalized)) throw new Error('Invalid NUMERIC(20,6) amount.');
  const match = normalized.match(/^(-?)(\d{1,14})(?:\.(\d{1,6}))?$/u);
  if (!match) throw new Error('Invalid NUMERIC(20,6) amount.');
  const fraction = (match[3] ?? '').padEnd(MONEY_SCALE, '0');
  const scaled = BigInt(match[2] ?? '0') * MONEY_SCALE_FACTOR + BigInt(fraction || '0');
  return match[1] ? -scaled : scaled;
}

/** Format exact scale-6 arithmetic back to canonical decimal text. */
export function scaledIntegerToDecimal(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  const fraction = (absolute % MONEY_SCALE_FACTOR).toString().padStart(MONEY_SCALE, '0');
  const trimmedFraction = fraction.replace(/0+$/u, '');
  return `${sign}${absolute / MONEY_SCALE_FACTOR}${trimmedFraction ? `.${trimmedFraction}` : ''}`;
}

export function assertSameCurrency(left: DecimalAmount, right: DecimalAmount): void {
  if (left.currency !== right.currency) {
    throw new Error(`Currency mismatch: ${left.currency} and ${right.currency}`);
  }
}

export const accountTypes = ['checking', 'savings', 'credit', 'cash', 'other'] as const;
export type AccountType = (typeof accountTypes)[number];

export const accountStatuses = ['active', 'archived'] as const;
export type AccountStatus = (typeof accountStatuses)[number];

export function normalizeInstitutionName(value: string): string {
  return value.trim().normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ');
}

export function isFullLookingAccountIdentifier(value: string): boolean {
  const compact = value.replace(/[\s-]/gu, '');
  return /^\d{8,}$/u.test(compact);
}

export function isFullLookingIban(value: string): boolean {
  const compact = value.replace(/[\s-]/gu, '').toUpperCase();
  return /^[A-Z]{2}\d{2}[A-Z0-9]{10,}$/u.test(compact);
}

export function isMaskedIdentifier(value: string, kind: 'account' | 'iban'): boolean {
  if (kind === 'account' && isFullLookingAccountIdentifier(value)) return false;
  if (kind === 'iban' && isFullLookingIban(value)) return false;
  return value.trim().length > 0;
}

export type ImportCandidateForValidation = {
  bookingDate?: string | null;
  description?: string | null;
  amount?: string | null;
  currency?: string | null;
  direction?: 'credit' | 'debit' | 'unknown' | null;
};

export function normalizeTransactionDescription(value: string): string {
  return value
    .normalize('NFKC')
    .split('')
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase('en-US');
}

export function validateImportCandidate(candidate: ImportCandidateForValidation): string[] {
  const warnings: string[] = [];
  if (!candidate.bookingDate) warnings.push('missing_booking_date');
  if (!candidate.description?.trim()) warnings.push('missing_description');
  if (!candidate.amount || !isSafeDecimalString(candidate.amount, false)) {
    warnings.push('invalid_amount');
  }
  if (!candidate.currency || !/^[A-Z]{3}$/u.test(candidate.currency))
    warnings.push('missing_currency');
  if (!candidate.direction || candidate.direction === 'unknown') warnings.push('unknown_direction');
  return warnings;
}

export type ReconciliationInput = {
  openingBalance: string | null;
  closingBalance: string | null;
  credits: string;
  debits: string;
  tolerance: string;
};

export type ReconciliationResult = {
  status: 'matched' | 'mismatch' | 'unverifiable';
  difference: string | null;
  expectedClosing: string | null;
  reason: string;
};

export function reconcileStatement(input: ReconciliationInput): ReconciliationResult {
  if (!input.openingBalance || !input.closingBalance) {
    return {
      status: 'unverifiable',
      difference: null,
      expectedClosing: null,
      reason: 'missing_balance',
    };
  }
  try {
    const expected =
      decimalToScaledInteger(input.openingBalance) +
      decimalToScaledInteger(input.credits) -
      decimalToScaledInteger(input.debits);
    const closing = decimalToScaledInteger(input.closingBalance);
    const difference = closing - expected;
    const tolerance = decimalToScaledInteger(input.tolerance);
    const mismatch = difference < -tolerance || difference > tolerance;
    return {
      status: mismatch ? 'mismatch' : 'matched',
      difference: scaledIntegerToDecimal(difference),
      expectedClosing: scaledIntegerToDecimal(expected),
      reason: mismatch ? 'balance_mismatch' : 'within_tolerance',
    };
  } catch {
    return {
      status: 'unverifiable',
      difference: null,
      expectedClosing: null,
      reason: 'invalid_balance_values',
    };
  }
}

export * from './classification';
export * from './merchants';
export * from './splits';
export * from './transfers';
