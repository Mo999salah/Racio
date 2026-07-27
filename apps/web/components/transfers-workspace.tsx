'use client';

import { useEffect, useState } from 'react';

type Labels = Record<string, string>;
type Transfer = {
  id: string;
  status: string;
  matchScore: number | null;
  outgoingAmount: string;
  incomingAmount: string;
  outgoingDate: string;
  incomingDate: string;
};

export function TransfersWorkspace({ labels }: { labels: Labels }) {
  const [items, setItems] = useState<Transfer[]>([]);
  const [outgoingId, setOutgoingId] = useState('');
  const [incomingId, setIncomingId] = useState('');
  const [notice, setNotice] = useState('');
  async function load() {
    const response = await fetch('/api/transfers?limit=50', { cache: 'no-store' });
    if (response.ok) setItems(await response.json());
  }
  useEffect(() => void load(), []);
  async function action(id: string, actionName: 'confirm' | 'reject' | 'unlink') {
    const response = await fetch(`/api/transfers/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: actionName }),
    });
    if (response.ok) {
      setNotice(labels.saved ?? 'Saved');
      void load();
    } else setNotice(labels.error ?? 'Update failed');
  }
  async function manual(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch('/api/transfers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        outgoingTransactionId: outgoingId,
        incomingTransactionId: incomingId,
      }),
    });
    if (response.ok) {
      setOutgoingId('');
      setIncomingId('');
      setNotice(labels.saved ?? 'Saved');
      void load();
    } else setNotice(labels.error ?? 'Update failed');
  }
  return (
    <div className="management-workspace">
      <form className="management-form" onSubmit={manual}>
        <label>
          {labels.outgoing}
          <input
            value={outgoingId}
            onChange={(event) => setOutgoingId(event.target.value)}
            required
          />
        </label>
        <label>
          {labels.incoming}
          <input
            value={incomingId}
            onChange={(event) => setIncomingId(event.target.value)}
            required
          />
        </label>
        <button className="primary-button" type="submit">
          {labels.link}
        </button>
      </form>
      <p className="form-note" role="status">
        {notice}
      </p>
      <div className="management-list">
        {items.map((item) => (
          <div className="management-row" key={item.id}>
            <div>
              <strong>
                {item.outgoingAmount} · {item.incomingAmount}
              </strong>
              <p>
                {item.outgoingDate} → {item.incomingDate} · {labels[item.status] ?? item.status} ·{' '}
                {item.matchScore ?? '—'}
              </p>
            </div>
            <div className="row-actions">
              {item.status !== 'confirmed' && (
                <button
                  className="text-button"
                  type="button"
                  onClick={() => void action(item.id, 'confirm')}
                >
                  {labels.confirm}
                </button>
              )}
              {item.status === 'suggested' && (
                <button
                  className="text-button"
                  type="button"
                  onClick={() => void action(item.id, 'reject')}
                >
                  {labels.reject}
                </button>
              )}
              {item.status === 'confirmed' && (
                <button
                  className="text-button"
                  type="button"
                  onClick={() => void action(item.id, 'unlink')}
                >
                  {labels.unlink}
                </button>
              )}
            </div>
          </div>
        ))}
        {!items.length && <p className="empty-note">{labels.empty}</p>}
      </div>
    </div>
  );
}
