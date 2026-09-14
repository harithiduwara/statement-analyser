/**
 * Theme selection.
 *
 * Three states, matching how a viewer actually expresses a preference:
 * an explicit light or dark choice stamps `data-theme` on the root, and
 * `system` stamps nothing so `prefers-color-scheme` decides. The choice is a
 * per-device convenience, so it lives in localStorage -- which can throw or
 * come back empty in a private window, and is handled as such.
 */

export type ThemeChoice = 'light' | 'dark' | 'system';

const KEY = 'sa.theme';

export function readTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Blocked or unavailable storage is not an error worth surfacing.
  }
  return 'system';
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // The theme still applies for this session.
  }
}

/** Whether dark styles are currently in effect, for chart colour lookups. */
export function isDarkActive(): boolean {
  const stamped = document.documentElement.getAttribute('data-theme');
  if (stamped === 'dark') return true;
  if (stamped === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}
