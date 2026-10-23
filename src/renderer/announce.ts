import { signal } from '@preact/signals';

/** Text announced to screen readers by the app's live region. */
export const announcement = signal('');

/** How long the live region stays empty before a message is written. */
export const ANNOUNCE_DELAY_MS = 100;

let pending: ReturnType<typeof setTimeout> | undefined;

/**
 * Empties the live region, then writes `text` in a later task. Screen readers
 * read what is inserted: a repeated message would insert nothing, and Firefox
 * reports only the part of a new message that differs from the previous one.
 * An empty region is not read.
 */
export function announce(text: string): void {
  clearTimeout(pending);
  announcement.value = '';
  pending = setTimeout(() => (announcement.value = text), ANNOUNCE_DELAY_MS);
}
