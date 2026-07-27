'use client';

import { useEffect } from 'react';
import type { UserPreferences } from '@racio/contracts';

export function ThemeSync({ appearance }: { appearance: UserPreferences['appearance'] }) {
  useEffect(() => {
    const apply = () => {
      const mode =
        appearance === 'system'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : appearance;
      document.documentElement.dataset.theme = mode;
    };
    apply();
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [appearance]);
  return null;
}
