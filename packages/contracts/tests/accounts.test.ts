import { describe, expect, it } from 'vitest';
import { financialAccountCreateSchema, institutionCreateSchema } from '../src/index';

describe('account contracts', () => {
  it('accepts complete institution and account payloads', () => {
    expect(
      institutionCreateSchema.parse({ name: 'Example Bank', countryCode: 'TR' }),
    ).toMatchObject({
      name: 'Example Bank',
      countryCode: 'TR',
    });
    expect(
      financialAccountCreateSchema.parse({
        institutionId: 'institution-id',
        displayName: 'Daily spending',
        accountType: 'checking',
        currencyCode: 'TRY',
        maskedAccountIdentifier: '•••• 1234',
        maskedIban: 'TR•• •••• 1326',
      }).currencyCode,
    ).toBe('TRY');
  });

  it('rejects full-looking account and IBAN values', () => {
    expect(() =>
      financialAccountCreateSchema.parse({
        institutionId: 'institution-id',
        displayName: 'Daily spending',
        accountType: 'checking',
        currencyCode: 'TRY',
        maskedAccountIdentifier: '123456789012',
      }),
    ).toThrow();
    expect(() =>
      financialAccountCreateSchema.parse({
        institutionId: 'institution-id',
        displayName: 'Daily spending',
        accountType: 'checking',
        currencyCode: 'TRY',
        maskedIban: 'TR330006100519786457841326',
      }),
    ).toThrow();
  });
});
