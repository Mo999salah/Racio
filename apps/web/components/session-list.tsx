'use client';

import { useState } from 'react';

type SessionItem = {
  id: string;
  createdAt: string;
  expiresAt: string;
  userAgent?: string | null;
  ipAddress?: string | null;
};

export function SessionList({
  initial,
  labels,
}: {
  initial: SessionItem[];
  labels: Record<string, string>;
}) {
  const [sessions, setSessions] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function revoke(id: string) {
    setBusy(true);
    const response = await fetch('/api/sessions', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (response.ok) setSessions((current) => current.filter((item) => item.id !== id));
    setBusy(false);
  }

  async function revokeGroup(action: 'revoke-others' | 'revoke-all') {
    setBusy(true);
    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'x-racio-session-action': action },
    });
    if (response.ok && action === 'revoke-all') window.location.assign('/en/sign-in');
    if (response.ok && action === 'revoke-others') setSessions((current) => current.slice(0, 1));
    setBusy(false);
  }

  return (
    <div className="session-list">
      <div className="session-actions">
        <button
          className="text-button"
          type="button"
          onClick={() => revokeGroup('revoke-others')}
          disabled={busy}
        >
          {labels.revokeOthers}
        </button>
        <button
          className="text-button danger"
          type="button"
          onClick={() => revokeGroup('revoke-all')}
          disabled={busy}
        >
          {labels.revokeAll}
        </button>
      </div>
      {sessions.map((session) => (
        <article className="session-row" key={session.id}>
          <div>
            <strong>{session.userAgent || labels.unknownDevice}</strong>
            <p>{session.ipAddress || labels.unknownIp}</p>
            <p>
              {labels.expires}: {new Date(session.expiresAt).toLocaleString()}
            </p>
          </div>
          <button
            className="text-button"
            type="button"
            onClick={() => revoke(session.id)}
            disabled={busy}
          >
            {labels.revoke}
          </button>
        </article>
      ))}
      {sessions.length === 0 ? <p>{labels.empty}</p> : null}
    </div>
  );
}
