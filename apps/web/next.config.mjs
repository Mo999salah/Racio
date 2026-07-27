import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

export default withNextIntl({
  transpilePackages: ['@racio/i18n', '@racio/ui'],
});
