import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getAuthProviderAvailability, getSession, safeReturnPath } from '@racio/auth';
import { ProviderSignIn } from '../../../components/provider-sign-in';

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
      <section className="auth-card" aria-labelledby="sign-in-title">
        <p className="eyebrow">{t('app.name')}</p>
        <h1 id="sign-in-title">{t('auth.title')}</h1>
        <p className="auth-description">{t('auth.description')}</p>
        {error ? (
          <p className="form-error" role="alert">
            {t('auth.callbackError')}
          </p>
        ) : null}
        <div className="provider-list">
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
        </div>
        {!providers.google && !providers.apple ? (
          <p className="empty-note">{t('auth.noProvider')}</p>
        ) : null}
        <p className="auth-privacy">{t('auth.privacy')}</p>
      </section>
    </main>
  );
}
