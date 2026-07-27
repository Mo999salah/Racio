'use client';

import { useState } from 'react';

type Mode = 'easy' | 'advanced';

export function ModeToggle({
  initialMode,
  easyLabel,
  advancedLabel,
}: {
  initialMode: Mode;
  easyLabel: string;
  advancedLabel: string;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [busy, setBusy] = useState(false);

  async function selectMode(nextMode: Mode) {
    setMode(nextMode);
    setBusy(true);
    const response = await fetch('/api/preferences', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ interfaceMode: nextMode }),
    });
    if (!response.ok) setMode(mode);
    setBusy(false);
  }

  return (
    <div className="mode-toggle" role="group" aria-label="Interface mode">
      <button
        type="button"
        className={mode === 'easy' ? 'mode-option mode-option-active' : 'mode-option'}
        onClick={() => selectMode('easy')}
        aria-pressed={mode === 'easy'}
        disabled={busy}
      >
        {easyLabel}
      </button>
      <button
        type="button"
        className={mode === 'advanced' ? 'mode-option mode-option-active' : 'mode-option'}
        onClick={() => selectMode('advanced')}
        aria-pressed={mode === 'advanced'}
        disabled={busy}
      >
        {advancedLabel}
      </button>
    </div>
  );
}
