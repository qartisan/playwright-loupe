/**
 * localStorage for per-viewer preferences (theme, sidebar). Every access is
 * guarded: storage can be missing or throw (file:// in some browsers, private
 * windows, blocked site data), and the report must work without it.
 */

export function readPreference(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePreference(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not remembered; the choice still applies to this page.
  }
}
