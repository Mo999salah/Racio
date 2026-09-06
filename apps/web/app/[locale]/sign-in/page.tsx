import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getAuthProviderAvailability, getSession, safeReturnPath } from '@racio/auth';
import { ProviderSignIn } from '../../../components/provider-sign-in';
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from '@/components/ui/card';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function SignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  const t = await getTranslations();
  const providers = getAuthProviderAvailability();
  if (providers.google || providers.apple) {
    const requestHeaders = await headers();
    if (await getSession(requestHeaders)) redirect(`/${locale}`);
  }
  const rawReturnTo = typeof query.returnTo === 'string' ? query.returnTo : undefined;
  const returnTo = safeReturnPath(rawReturnTo, `/${locale}`);
  const error = typeof query.error === 'string' ? query.error : undefined;

  return (
    <main className="auth-page">
      <Card className="w-full max-w-md" aria-labelledby="sign-in-title">
        <CardHeader>
          <p className="text-sm text-muted-foreground">{t('app.name')}</p>
          <h1 id="sign-in-title" className="text-2xl font-semibold tracking-tight">
            {t('auth.title')}
          </h1>
          <CardDescription>{t('auth.description')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {error ? (
            <p className="form-error" role="alert">
              {t('auth.callbackError')}
            </p>
          ) : null}
          {providers.google ? (
            <ProviderSignIn
              provider="google"
              label={t('auth.continueGoogle')}
              errorLabel={t('auth.callbackError')}
              callbackURL={returnTo}
            />
          ) : null}
          {providers.apple ? (
            <ProviderSignIn
              provider="apple"
              label={t('auth.continueApple')}
              errorLabel={t('auth.callbackError')}
              callbackURL={returnTo}
            />
          ) : null}
          {!providers.google && !providers.apple ? <p className="empty-note">{t('auth.noProvider')}</p> : null}
        </CardContent>
        <CardFooter>
          <p className="text-sm text-muted-foreground">{t('auth.privacy')}</p>
        </CardFooter>
      </Card>
    </main>
  );
}
