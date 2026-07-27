import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { AuthBoundaryError, ensureUserPreferences, requireUser } from '@racio/auth';
import { AccountShell } from '../../../components/account-shell';
import { PreferenceForm } from '../../../components/preference-form';
import { ThemeSync } from '../../../components/theme-sync';
import { database } from '../../../lib/database';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function SettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const requestHeaders = await headers();
  let user;
  try {
    user = await requireUser(requestHeaders);
  } catch (error) {
    if (!(error instanceof AuthBoundaryError)) throw error;
    redirect(`/${locale}/sign-in?returnTo=/${locale}/settings`);
  }
  const preferences = await ensureUserPreferences(database.db, user.id);
  const t = await getTranslations('settings');
  return (
    <AccountShell locale={locale} name={user.name}>
      <ThemeSync appearance={preferences.appearance} />
      <section className="settings-page" aria-labelledby="settings-title">
        <div className="page-heading">
          <p className="eyebrow">{t('eyebrow')}</p>
          <h1 id="settings-title">{t('title')}</h1>
          <p>{t('description')}</p>
        </div>
        <PreferenceForm
          initial={preferences}
          labels={{
            locale: t('locale'),
            timeZone: t('timeZone'),
            interfaceMode: t('interfaceMode'),
            appearance: t('appearance'),
            currency: t('currency'),
            easy: t('easy'),
            advanced: t('advanced'),
            system: t('system'),
            light: t('light'),
            dark: t('dark'),
            unset: t('unset'),
            save: t('save'),
            saving: t('saving'),
            saved: t('saved'),
            error: t('error'),
          }}
        />
      </section>
    </AccountShell>
  );
}
