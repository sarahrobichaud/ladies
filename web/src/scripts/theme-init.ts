export type Theme = 'light' | 'dark';

export const STORAGE_KEY = 'ladies-theme';

export function readStoredTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

/** Set `data-theme` on <html> before React renders so the first paint
 *  already matches the stored/system theme. Call once at startup. */
export function initTheme(): Theme {
  const theme = readStoredTheme();
  document.documentElement.dataset.theme = theme;
  return theme;
}
