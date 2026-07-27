import { describe, expect, it } from 'vitest';
import {
  accountStatuses,
  accountTypes,
  isFullLookingAccountIdentifier,
  isFullLookingIban,
  isMaskedIdentifier,
  normalizeInstitutionName,
} from '../src/index';

describe('account domain rules', () => {
  it('normalizes institution names deterministically', () => {
    expect(normalizeInstitutionName('  İş  Bankası\u00a0  Şube  ')).toBe('i\u0307ş bankası şube');
  });

  it('keeps the account type and status allow-lists explicit', () => {
    expect(accountTypes).toEqual(['checking', 'savings', 'credit', 'cash', 'other']);
    expect(accountStatuses).toEqual(['active', 'archived']);
  });

  it('rejects full-looking identifiers while accepting masked values', () => {
    expect(isFullLookingAccountIdentifier('1234 5678 9012')).toBe(true);
    expect(isMaskedIdentifier('•••• 9012', 'account')).toBe(true);
    expect(isFullLookingIban('TR330006100519786457841326')).toBe(true);
    expect(isMaskedIdentifier('TR•• •••• 1326', 'iban')).toBe(true);
  });
});
