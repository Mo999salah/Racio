import { decimalToScaledInteger } from './index';

export type TransferCandidate = {
  amount: string;
  currencyCode: string;
  direction: 'credit' | 'debit' | 'unknown';
  bookingDate: string;
  financialAccountId: string;
  accountName: string;
  bankTransactionId: string | null;
  description: string;
  hasActiveSplits: boolean;
  archived: boolean;
};

export type TransferEvaluation = {
  eligible: boolean;
  score: number | null;
  reasons: string[];
  dateDifference: number | null;
};

function daysBetween(left: string, right: string): number | null {
  const leftTime = Date.parse(`${left}T00:00:00Z`);
  const rightTime = Date.parse(`${right}T00:00:00Z`);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return null;
  return Math.abs(Math.round((leftTime - rightTime) / 86_400_000));
}

export function evaluateTransferPair(
  outgoing: TransferCandidate,
  incoming: TransferCandidate,
  maxDateDifference = 3,
): TransferEvaluation {
  const reasons: string[] = [];
  if (outgoing.archived || incoming.archived)
    return {
      eligible: false,
      score: null,
      reasons: ['archived_transaction'],
      dateDifference: null,
    };
  if (outgoing.hasActiveSplits || incoming.hasActiveSplits)
    return { eligible: false, score: null, reasons: ['split_transaction'], dateDifference: null };
  if (outgoing.financialAccountId === incoming.financialAccountId)
    return { eligible: false, score: null, reasons: ['same_account'], dateDifference: null };
  if (outgoing.direction !== 'debit' || incoming.direction !== 'credit')
    return {
      eligible: false,
      score: null,
      reasons: ['directions_not_opposite'],
      dateDifference: null,
    };
  if (outgoing.currencyCode !== incoming.currencyCode)
    return { eligible: false, score: null, reasons: ['currency_mismatch'], dateDifference: null };
  let outgoingAmount: bigint;
  let incomingAmount: bigint;
  try {
    outgoingAmount = decimalToScaledInteger(outgoing.amount);
    incomingAmount = decimalToScaledInteger(incoming.amount);
  } catch {
    return { eligible: false, score: null, reasons: ['invalid_amount'], dateDifference: null };
  }
  if (outgoingAmount !== incomingAmount)
    return { eligible: false, score: null, reasons: ['amount_mismatch'], dateDifference: null };
  reasons.push('exact_amount_match', 'same_currency', 'opposite_directions', 'different_accounts');
  const dateDifference = daysBetween(outgoing.bookingDate, incoming.bookingDate);
  if (dateDifference === null || dateDifference > maxDateDifference)
    return { eligible: false, score: null, reasons: ['date_outside_window'], dateDifference };
  reasons.push(`booking_dates_${dateDifference}_days_apart`);
  let score = 90;
  const lowerDescription = `${outgoing.description} ${incoming.description}`.toLocaleLowerCase(
    'en-US',
  );
  if (lowerDescription.includes('transfer')) {
    score += 5;
    reasons.push('transfer_word');
  }
  if (
    outgoing.bankTransactionId &&
    incoming.bankTransactionId &&
    outgoing.bankTransactionId === incoming.bankTransactionId
  ) {
    score += 5;
    reasons.push('matching_bank_transaction_id');
  }
  if (
    lowerDescription.includes(incoming.accountName.toLocaleLowerCase('en-US')) ||
    lowerDescription.includes(outgoing.accountName.toLocaleLowerCase('en-US'))
  ) {
    score += 5;
    reasons.push('account_name_in_description');
  }
  return { eligible: true, score, reasons, dateDifference };
}

export function excludesFromIncomeExpense(
  status: 'suggested' | 'confirmed' | 'rejected' | 'unlinked',
) {
  return status === 'confirmed';
}
