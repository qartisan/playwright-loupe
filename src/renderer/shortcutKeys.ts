/**
 * The key a single-key shortcut is matched against. Shortcuts are lower-case
 * letters and two symbols (`/`, `?`), read from `event.key`, so they follow
 * the keyboard layout. With Caps Lock on, a letter arrives in upper case: it
 * is matched in lower case, unless Shift is held (Shift+letter is left free).
 *
 * Pure function, no DOM: unit-tested in Node.
 */
export function shortcutKey(event: { key: string; shiftKey: boolean }): string {
  return !event.shiftKey && event.key.length === 1 ? event.key.toLowerCase() : event.key;
}
