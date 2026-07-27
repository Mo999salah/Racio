import { defineRouting } from 'next-intl/routing';
import { defaultLocale, locales } from '@racio/i18n';

export const routing = defineRouting({
  locales: [...locales],
  defaultLocale,
  localePrefix: 'always',
});
