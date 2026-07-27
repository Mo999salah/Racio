'use client';

import { useEffect, useState } from 'react';

type Labels = Record<string, string>;
type Merchant = {
  id: string;
  displayName: string;
  status: string;
  mergedIntoMerchantId: string | null;
};
type Alias = { id: string; rawPattern: string; matchType: string; enabled: boolean };

export function MerchantsWorkspace({ labels }: { labels: Labels }) {
  const [items, setItems] = useState<Merchant[]>([]);
  const [name, setName] = useState('');
  const [pattern, setPattern] = useState('');
  const [matchType, setMatchType] = useState('normalized_description_contains');
  const [selectedId, setSelectedId] = useState('');
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [mergeTarget, setMergeTarget] = useState('');
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<{ matches: unknown[]; previewHash: string } | null>(null);

  async function load() {
    const response = await fetch('/api/merchants', { cache: 'no-store' });
    if (response.ok) setItems(await response.json());
  }
  async function loadAliases(id: string) {
    const response = await fetch(`/api/merchants/${id}/aliases`, { cache: 'no-store' });
    if (response.ok) setAliases(await response.json());
  }
  useEffect(() => void load(), []);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch('/api/merchants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: name }),
    });
    if (!response.ok) return setNotice(labels.error ?? 'Save failed');
    setName('');
    setNotice(labels.saved ?? 'Saved');
    void load();
  }
  async function createAlias(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedId) return;
    const response = await fetch(`/api/merchants/${selectedId}/aliases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawPattern: pattern, matchType }),
    });
    if (!response.ok) return setNotice(labels.error ?? 'Save failed');
    setPattern('');
    setNotice(labels.saved ?? 'Saved');
    void loadAliases(selectedId);
  }
  async function aliasAction(id: string, action: 'enable' | 'disable') {
    const response = await fetch(`/api/merchant-aliases/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (response.ok) void loadAliases(selectedId);
    else setNotice(labels.error ?? 'Update failed');
  }
  async function previewAliases() {
    const response = await fetch('/api/merchant-aliases/preview', { method: 'POST' });
    if (response.ok) setPreview(await response.json());
    else setNotice(labels.error ?? 'Preview failed');
  }
  async function applyAliases() {
    if (!preview) return;
    const response = await fetch('/api/merchant-aliases/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true, previewHash: preview.previewHash }),
    });
    if (response.ok) {
      setNotice(labels.applied ?? 'Applied');
      setPreview(null);
    } else setNotice(labels.error ?? 'Apply failed');
  }
  async function merge() {
    if (!selectedId || !mergeTarget) return;
    const response = await fetch(`/api/merchants/${selectedId}/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetMerchantId: mergeTarget, confirm: true }),
    });
    if (response.ok) {
      setNotice(labels.merged ?? 'Merged');
      setSelectedId('');
      setMergeTarget('');
      void load();
    } else setNotice(labels.error ?? 'Update failed');
  }
  async function unmerge(id: string) {
    const response = await fetch(`/api/merchants/${id}/unmerge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    });
    if (response.ok) {
      setNotice(labels.unmerged ?? 'Restored');
      void load();
    } else setNotice(labels.error ?? 'Update failed');
  }

  return (
    <div className="management-workspace">
      <form className="management-form" onSubmit={create}>
        <label>
          {labels.name}
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <button className="primary-button" type="submit">
          {labels.create}
        </button>
        <button className="text-button" type="button" onClick={() => void previewAliases()}>
          {labels.preview}
        </button>
        {preview && (
          <button className="text-button" type="button" onClick={() => void applyAliases()}>
            {labels.apply}
          </button>
        )}
      </form>
      {preview && (
        <p className="form-note">
          {preview.matches.length} {labels.matches}
        </p>
      )}
      <p className="form-note" role="status">
        {notice}
      </p>
      <div className="management-list">
        {items.map((item) => (
          <div className="management-row" key={item.id}>
            <div>
              <strong>{item.displayName}</strong>
              <p>{labels[item.status] ?? item.status}</p>
              {item.status === 'merged' && (
                <button className="text-button" type="button" onClick={() => void unmerge(item.id)}>
                  {labels.unmerge}
                </button>
              )}
            </div>
            {item.status === 'active' && (
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setSelectedId(item.id);
                  void loadAliases(item.id);
                }}
              >
                {selectedId === item.id ? labels.close : labels.aliases}
              </button>
            )}
            {selectedId === item.id && item.status === 'active' && (
              <div className="management-inline">
                <form onSubmit={createAlias}>
                  <label>
                    {labels.pattern}
                    <input
                      value={pattern}
                      onChange={(event) => setPattern(event.target.value)}
                      required
                    />
                  </label>
                  <label>
                    {labels.matchType}
                    <select
                      value={matchType}
                      onChange={(event) => setMatchType(event.target.value)}
                    >
                      <option value="normalized_description_contains">{labels.contains}</option>
                      <option value="exact_normalized_description">{labels.exact}</option>
                      <option value="normalized_description_starts_with">
                        {labels.startsWith}
                      </option>
                      <option value="exact_counterparty">{labels.counterparty}</option>
                      <option value="counterparty_contains">{labels.counterpartyContains}</option>
                    </select>
                  </label>
                  <button className="primary-button" type="submit">
                    {labels.addAlias}
                  </button>
                </form>
                {aliases.map((alias) => (
                  <div className="management-row" key={alias.id}>
                    <span>
                      {alias.rawPattern} · {labels[alias.matchType] ?? alias.matchType}
                    </span>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() =>
                        void aliasAction(alias.id, alias.enabled ? 'disable' : 'enable')
                      }
                    >
                      {alias.enabled ? labels.disable : labels.enable}
                    </button>
                  </div>
                ))}
                <label>
                  {labels.mergeInto}
                  <select
                    value={mergeTarget}
                    onChange={(event) => setMergeTarget(event.target.value)}
                  >
                    <option value="">{labels.chooseMerchant}</option>
                    {items
                      .filter(
                        (candidate) => candidate.id !== item.id && candidate.status === 'active',
                      )
                      .map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.displayName}
                        </option>
                      ))}
                  </select>
                </label>
                <button className="text-button" type="button" onClick={() => void merge()}>
                  {labels.merge}
                </button>
              </div>
            )}
          </div>
        ))}
        {!items.length && <p className="empty-note">{labels.empty}</p>}
      </div>
    </div>
  );
}
