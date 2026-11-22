import type { ComponentChildren } from 'preact';
import { InfoIcon } from './icons.js';

/**
 * A run-level notice, set apart so that it is not missed inside the verdict or a test's history: a note, not an
 * error (a neutral background, an information icon). The icon is hidden; "Note:" is its text alternative.
 */
export function HistoryNotice({ children }: { children: ComponentChildren }) {
  return (
    <p class="history-notice">
      <InfoIcon />
      <span>
        <span class="visually-hidden">Note: </span>
        {children}
      </span>
    </p>
  );
}
