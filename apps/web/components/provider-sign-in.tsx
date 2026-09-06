'use client';

import { useState } from 'react';
import { authClient } from '../lib/auth-client';
import { Button } from '@/components/ui/button';

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
    <div className="grid gap-2">
      <Button type="button" className="w-full" size="lg" onClick={signIn} disabled={busy}>
        {busy ? '…' : label}
      </Button>
      {error ? (
        <p className="form-error" role="alert">
          {errorLabel}
        </p>
      ) : null}
    </div>
  );
}
