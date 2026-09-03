import { describe, expect, it } from 'vitest';
import { resolveDateLocale } from './accounts-workspace';

describe('resolveDateLocale', () => {
  it('prefers the routed locale and falls back cleanly when the root html lang is empty', () => {
    expect(resolveDateLocale('ar', { documentElement: { lang: '' } } as Document)).toBe('ar');
    expect(resolveDateLocale('', { documentElement: { lang: '' } } as Document)).toBe('en');
    expect(resolveDateLocale('tr', { documentElement: { lang: 'invalid' } } as Document)).toBe(
      'tr',
    );
  });
});
