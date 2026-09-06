import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getMessages, getLocale, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { directionForLocale, locales } from '@racio/i18n';
import { routing } from '../../i18n/routing';
import { DirectionProvider } from '@/components/ui/direction';

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{ children: React.ReactNode; params: Promise<{ locale: string }> }>) {
  const { locale: requestedLocale } = await params;
  if (!hasLocale(routing.locales, requestedLocale)) notFound();

  setRequestLocale(requestedLocale);
  const locale = await getLocale();
  const messages = await getMessages();
  const direction = directionForLocale(locale);

  return (
    <div lang={locale} dir={direction} className="min-h-screen bg-background text-foreground">
      <DirectionProvider dir={direction}>
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </DirectionProvider>
    </div>
  );
}
