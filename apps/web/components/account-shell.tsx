import { getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import { getSession } from '@racio/auth';
import { unreadAlertCount } from '@racio/planning';
import { database } from '../lib/database';
import { SignOutButton } from './sign-out-button';
import { Badge } from '@/components/ui/badge';

export async function AccountShell({
  locale,
  name,
  children,
}: {
  locale: string;
  name: string;
  children: React.ReactNode;
}) {
  const t = await getTranslations();
  const session = await getSession(await headers());
  const unread = session ? await unreadAlertCount(database.db, session.user.id) : 0;
  return (
    <div className="racio-shell">
      <a className="skip-link" href="#main-content">
        {t('nav.skip')}
      </a>
      <header className="racio-topbar">
        <div className="brand-block">
          <p className="brand-mark">{t('app.name')}</p>
          <p className="brand-tagline">{name}</p>
        </div>
        <nav aria-label={t('nav.primary')} className="top-nav">
          <a className="nav-link" href={`/${locale}`}>
            {t('nav.workspace')}
          </a>
          <a className="nav-link" href={`/${locale}/accounts`}>
            {t('nav.accounts')}
          </a>
          <a className="nav-link" href={`/${locale}/transactions`}>
            {t('nav.transactions')}
          </a>
          <a className="nav-link" href={`/${locale}/categories`}>
            {t('nav.categories')}
          </a>
          <a className="nav-link" href={`/${locale}/rules`}>
            {t('nav.rules')}
          </a>
          <a className="nav-link" href={`/${locale}/merchants`}>
            {t('nav.merchants')}
          </a>
          <a className="nav-link" href={`/${locale}/transfers`}>
            {t('nav.transfers')}
          </a>
          <a className="nav-link" href={`/${locale}/budgets`}>
            {t('nav.budgets')}
          </a>
          <a className="nav-link" href={`/${locale}/goals`}>
            {t('nav.goals')}
          </a>
          <a className="nav-link" href={`/${locale}/alerts`}>
            {t('nav.alerts')}
            {unread > 0 ? <Badge className="ms-1 tabular-nums">{unread}</Badge> : null}
          </a>
          <a className="nav-link" href={`/${locale}/advisor`}>
            {t('nav.advisor')}
          </a>
          <a className="nav-link" href={`/${locale}/export`}>
            {t('nav.export')}
          </a>
          <a className="nav-link" href={`/${locale}/settings`}>
            {t('nav.settings')}
          </a>
          <a className="nav-link" href={`/${locale}/sessions`}>
            {t('nav.sessions')}
          </a>
        </nav>
        <div className="topbar-actions">
          <SignOutButton label={t('auth.signOut')} locale={locale} />
        </div>
      </header>
      <main id="main-content">{children}</main>
    </div>
  );
}
