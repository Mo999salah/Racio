import { describe, expect, it } from 'vitest';
import { getAuthProviderAvailability, safeReturnPath } from '../src/index';

describe('auth boundary', () => {
  it('boots with no configured providers', () => {
    expect(getAuthProviderAvailability()).toEqual({ google: false, apple: false });
  });

  it('accepts internal return paths and rejects open redirects', () => {
    expect(safeReturnPath('/en/settings', '/en')).toBe('/en/settings');
    expect(safeReturnPath('//evil.example', '/en')).toBe('/en');
    expect(safeReturnPath('https://evil.example', '/en')).toBe('/en');
    expect(safeReturnPath('/\\evil', '/en')).toBe('/en');
  });
});
