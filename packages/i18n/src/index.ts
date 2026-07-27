export const locales = ['ar', 'en', 'tr'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';

import ar from './messages/ar.json';
import en from './messages/en.json';
import tr from './messages/tr.json';

export const messages = { ar, en, tr } as const;

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

export function directionForLocale(locale: string): 'rtl' | 'ltr' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}
