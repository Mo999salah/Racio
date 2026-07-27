'use client';

import { useState } from 'react';
import type { UserPreferences } from '@racio/contracts';

const currencies = ['AED', 'CAD', 'CHF', 'EGP', 'EUR', 'GBP', 'JPY', 'SAR', 'TRY', 'USD'];

export function PreferenceForm({
  initial,
  labels,
}: {
  initial: UserPreferences;
  labels: Record<string, string>;
}) {
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);
  const timeZones =
    typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : ['UTC', 'Europe/Istanbul', 'Asia/Riyadh', 'America/New_York'];

  function update<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    if (key === 'appearance') {
      const appearance = value as UserPreferences['appearance'];
      document.documentElement.dataset.theme =
        appearance === 'system'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : appearance;
    }
    setSaved(false);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(false);
    const response = await fetch('/api/preferences', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(values),
    });
    if (response.ok) {
      setValues(await response.json());
      setSaved(true);
      if (values.locale !== document.documentElement.lang) {
        window.location.assign(`/${values.locale}/settings`);
        return;
      }
    } else {
      setError(true);
    }
    setBusy(false);
  }

  return (
    <form className="settings-form" onSubmit={save}>
      <label>
        {labels.locale}
        <select
          value={values.locale}
          onChange={(event) => update('locale', event.target.value as UserPreferences['locale'])}
        >
          <option value="ar">العربية</option>
          <option value="en">English</option>
          <option value="tr">Türkçe</option>
        </select>
      </label>
      <label>
        {labels.timeZone}
        <select
          value={values.timeZone}
          onChange={(event) => update('timeZone', event.target.value)}
        >
          {timeZones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </label>
      <label>
        {labels.interfaceMode}
        <select
          value={values.interfaceMode}
          onChange={(event) =>
            update('interfaceMode', event.target.value as UserPreferences['interfaceMode'])
          }
        >
          <option value="easy">{labels.easy}</option>
          <option value="advanced">{labels.advanced}</option>
        </select>
      </label>
      <label>
        {labels.appearance}
        <select
          value={values.appearance}
          onChange={(event) =>
            update('appearance', event.target.value as UserPreferences['appearance'])
          }
        >
          <option value="system">{labels.system}</option>
          <option value="light">{labels.light}</option>
          <option value="dark">{labels.dark}</option>
        </select>
      </label>
      <label>
        {labels.currency}
        <select
          value={values.baseCurrency ?? ''}
          onChange={(event) =>
            update('baseCurrency', event.target.value ? event.target.value : null)
          }
        >
          <option value="">{labels.unset}</option>
          {currencies.map((currency) => (
            <option key={currency} value={currency}>
              {currency}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="primary-button" disabled={busy}>
        {busy ? labels.saving : labels.save}
      </button>
      {saved ? (
        <p className="form-success" role="status">
          {labels.saved}
        </p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {labels.error}
        </p>
      ) : null}
    </form>
  );
}
