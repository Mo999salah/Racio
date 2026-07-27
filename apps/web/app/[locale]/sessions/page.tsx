import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { AuthBoundaryError, auth, requireUser } from '@racio/auth';
import { AccountShell } from '../../../components/account-shell';
import { SessionList } from '../../../components/session-list';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function SessionsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const requestHeaders = await headers();
  let user;
  try {
    user = await requireUser(requestHeaders);
  } catch (error) {
    if (!(error instanceof AuthBoundaryError)) throw error;
    redirect(`/${locale}/sign-in?returnTo=/${locale}/sessions`);
  }
  const sessions = await auth.api.listSessions({ headers: requestHeaders });
  const t = await getTranslations('sessions');
  const labels = {
    revokeOthers: t('revokeOthers'),
    revokeAll: t('revokeAll'),
    revoke: t('revoke'),
    unknownDevice: t('unknownDevice'),
    unknownIp: t('unknownIp'),
    expires: t('expires'),
    empty: t('empty'),
  };
  return (
    <AccountShell locale={locale} name={user.name}>
      <section className="settings-page" aria-labelledby="sessions-title">
        <div className="page-heading">
          <p className="eyebrow">{t('eyebrow')}</p>
          <h1 id="sessions-title">{t('title')}</h1>
          <p>{t('description')}</p>
        </div>
        <SessionList
          initial={sessions.map((session) => ({
            id: session.id,
            createdAt: session.createdAt.toISOString(),
            expiresAt: session.expiresAt.toISOString(),
            userAgent: session.userAgent,
            ipAddress: session.ipAddress,
          }))}
          labels={labels}
        />
      </section>
    </AccountShell>
  );
}
