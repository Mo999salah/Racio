import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { AuthBoundaryError, requireUser } from '@racio/auth';
import { ensureUserPreferences } from '@racio/auth';
import { Button } from '@racio/ui';
import { ModeToggle } from '../../components/mode-toggle';
import { AccountShell } from '../../components/account-shell';
import { ThemeSync } from '../../components/theme-sync';
import { database } from '../../lib/database';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const requestHeaders = await headers();
  let user;
  try {
    user = await requireUser(requestHeaders);
  } catch (error) {
    if (!(error instanceof AuthBoundaryError)) throw error;
    redirect(`/${locale}/sign-in?returnTo=/${locale}`);
  }
  const preferences = await ensureUserPreferences(database.db, user.id);
  const t = await getTranslations();

  return (
    <AccountShell locale={locale} name={user.name}>
      <ThemeSync appearance={preferences.appearance} />
      <section className="workspace-intro" aria-labelledby="workspace-title">
        <div className="intro-copy">
          <p className="eyebrow">{t('app.foundation')}</p>
          <h1 id="workspace-title">{t('home.title')}</h1>
          <p className="intro-description">{t('home.description')}</p>
        </div>
        <div className="status-note" role="status">
          <span className="status-mark" aria-hidden="true" />
          <span>{t('app.status')}</span>
        </div>
      </section>
      <section className="workspace-grid" aria-label={t('nav.workspace')}>
        <article className="empty-panel">
          <div className="panel-rule" aria-hidden="true" />
          <p className="panel-kicker">{t('home.emptyTitle')}</p>
          <p className="panel-body">{t('home.emptyDescription')}</p>
          <Button variant="quiet" type="button" disabled>
            {t('home.next')}
          </Button>
        </article>
        <aside className="mode-panel" aria-labelledby="mode-title">
          <div>
            <p className="panel-kicker" id="mode-title">
              {t('home.mode')}
            </p>
            <p className="panel-body">{t('home.modeHint')}</p>
          </div>
          <ModeToggle
            initialMode={preferences.interfaceMode}
            easyLabel={t('home.easy')}
            advancedLabel={t('home.advanced')}
          />
        </aside>
      </section>
      <footer className="workspace-footer">
        <span>{t('home.next')}</span>
        <span>{t('home.nextDescription')}</span>
      </footer>
    </AccountShell>
  );
}
