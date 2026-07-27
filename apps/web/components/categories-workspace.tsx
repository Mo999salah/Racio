'use client';

import { useEffect, useState } from 'react';

type Labels = Record<string, string>;
type Category = {
  id: string;
  name: string;
  kind: string;
  parentId: string | null;
  status: string;
  usageCount: number;
};

export function CategoriesWorkspace({ labels }: { labels: Labels }) {
  const [items, setItems] = useState<Category[]>([]);
  const [name, setName] = useState('');
  const [kind, setKind] = useState('expense');
  const [error, setError] = useState('');

  async function load() {
    const response = await fetch('/api/categories', { cache: 'no-store' });
    if (response.ok) setItems(await response.json());
  }
  useEffect(() => {
    void load();
  }, []);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, kind }),
    });
    if (!response.ok) {
      setError(labels.error ?? 'Save failed');
      return;
    }
    setName('');
    setError('');
    void load();
  }

  async function toggle(item: Category) {
    const action = item.status === 'active' ? 'archive' : 'restore';
    const response = await fetch(`/api/categories/${item.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (response.ok) void load();
    else setError(labels.error ?? 'Save failed');
  }

  return (
    <div className="management-workspace">
      <form className="management-form" onSubmit={create}>
        <label>
          {labels.name}
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label>
          {labels.kind}
          <select value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="expense">{labels.expense}</option>
            <option value="income">{labels.income}</option>
            <option value="transfer">{labels.transfer}</option>
            <option value="neutral">{labels.neutral}</option>
          </select>
        </label>
        <button className="primary-button" type="submit">
          {labels.create}
        </button>
      </form>
      <p className="form-error" role="alert">
        {error}
      </p>
      <div className="management-list">
        {items.map((item) => (
          <div className="management-row" key={item.id}>
            <div>
              <strong>{item.name}</strong>
              <p>
                {labels[item.kind] || item.kind} · {item.usageCount} {labels.usage}
              </p>
            </div>
            <button className="text-button" type="button" onClick={() => void toggle(item)}>
              {item.status === 'active' ? labels.archive : labels.restore}
            </button>
          </div>
        ))}
        {!items.length && <p className="empty-note">{labels.empty}</p>}
      </div>
    </div>
  );
}
