'use client';

import { useState } from 'react';
import { authClient } from '../lib/auth-client';

export function ProviderSignIn({
  provider,
  label,
  callbackURL,
  errorLabel,
}: {
  provider: 'google' | 'apple';
  label: string;
  callbackURL: string;
  errorLabel: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function signIn() {
    setBusy(true);
    setError(false);
    const result = await authClient.signIn.social({ provider, callbackURL });
    if (result.error) {
      setBusy(false);
      setError(true);
    }
  }

  return (
    <div>
      <button type="button" className="provider-button" onClick={signIn} disabled={busy}>
        {busy ? '…' : label}
      </button>
      {error ? (
        <p className="form-error" role="alert">
          {errorLabel}
        </p>
      ) : null}
    </div>
  );
}
