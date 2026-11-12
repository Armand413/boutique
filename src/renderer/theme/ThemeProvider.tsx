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

/** Surface utile de référence (écran 1366 × 768, barres de Windows déduites) et bornes du facteur. */
const REFERENCE = { width: 1366, height: 680 };
const FIT_BOUNDS = { min: 0.7, max: 1.2 };

/**
 * Facteur d'échelle de l'interface selon la fenêtre (D92) : tout tient sur un petit écran ou avec
 * la mise à l'échelle de Windows (125 %, 150 %), et grossit un peu sur un grand écran.
 */
export function fitScale(width: number, height: number): number {
  const ratio = Math.min(width / REFERENCE.width, height / REFERENCE.height);
  const bounded = Math.min(FIT_BOUNDS.max, Math.max(FIT_BOUNDS.min, ratio));
  return Math.round(bounded * 100) / 100;
}

function useFitScale(): number {
  const [scale, setScale] = useState(() => fitScale(window.innerWidth, window.innerHeight));
  useEffect(() => {
    const update = (): void => setScale(fitScale(window.innerWidth, window.innerHeight));
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return scale;
}

/** Applique thème, taille du texte, ajustement à la fenêtre et langue sur l'élément racine. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { theme, textScale, language } = usePreferences((state) => state.preferences);
  const systemPrefersDark = useSystemPrefersDark();
  const resolved = resolveTheme(theme, systemPrefersDark);
  const fit = useFitScale();

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolved === 'dark');
    root.dataset.theme = resolved;
    root.style.setProperty('--text-scale', String(textScale));
    root.style.setProperty('--fit-scale', String(fit));
    root.lang = language;
  }, [resolved, textScale, language, fit]);

  return <>{children}</>;
}
