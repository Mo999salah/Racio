'use client';

import { useState } from 'react';
import { authClient } from '../lib/auth-client';
import { Button } from '@/components/ui/button';

export function SignOutButton({ label, locale }: { label: string; locale: string }) {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    await authClient.signOut();
    window.location.assign(`/${locale}/sign-in`);
  }

  return (
    <Button type="button" variant="outline" size="lg" onClick={signOut} disabled={busy}>
      {busy ? '…' : label}
    </Button>
  );
}
