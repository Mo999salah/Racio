import { describe, expect, it } from 'vitest';
import { preferencePatchSchema, preferenceSchema } from '../src/index';

describe('preference contract', () => {
  it('accepts defaults and valid IANA/currency values', () => {
    expect(
      preferenceSchema.parse({
        locale: 'en',
        timeZone: 'Europe/Istanbul',
        interfaceMode: 'easy',
        appearance: 'system',
        baseCurrency: 'TRY',
      }).baseCurrency,
    ).toBe('TRY');
  });

  it('rejects client ownership fields and invalid values', () => {
    expect(() => preferencePatchSchema.parse({ userId: 'other-user' })).toThrow();
    expect(() => preferencePatchSchema.parse({ timeZone: 'not-a-time-zone' })).toThrow();
    expect(() => preferencePatchSchema.parse({ baseCurrency: 'US' })).toThrow();
  });
});
