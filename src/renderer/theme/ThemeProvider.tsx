import { useEffect, useState } from 'react';
import type { Theme } from '@shared/schemas/preferences';
import { usePreferences } from '../stores/preferences';

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function resolveTheme(theme: Theme, systemPrefersDark: boolean): 'light' | 'dark' {
  if (theme === 'system') return systemPrefersDark ? 'dark' : 'light';
  return theme;
}

function useSystemPrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = useState(() => window.matchMedia(DARK_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const listener = (event: MediaQueryListEvent): void => setPrefersDark(event.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);
  return prefersDark;
}

/** Applique thème, taille du texte et langue sur l'élément racine du document. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { theme, textScale, language } = usePreferences((state) => state.preferences);
  const systemPrefersDark = useSystemPrefersDark();
  const resolved = resolveTheme(theme, systemPrefersDark);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolved === 'dark');
    root.dataset.theme = resolved;
    root.style.setProperty('--text-scale', String(textScale));
    root.lang = language;
  }, [resolved, textScale, language]);

  return <>{children}</>;
}
