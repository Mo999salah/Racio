import { describe, expect, it } from 'vitest';
import { directionForLocale } from '../src/index';

describe('locale direction', () => {
  it('keeps Arabic RTL and other supported locales LTR', () => {
    expect(directionForLocale('ar')).toBe('rtl');
    expect(directionForLocale('en')).toBe('ltr');
    expect(directionForLocale('tr')).toBe('ltr');
  });
});
