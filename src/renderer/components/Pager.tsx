import { ChevronIcon } from './icons.js';

/**
 * Previous / next buttons around a position (`12 of 40`). A button is
 * disabled at its end of the list: no wrap-around.
 */
export function Pager({
  label,
  position,
  total,
  outside,
  previous,
  next,
  previousLabel,
  nextLabel,
  keys,
}: {
  /** Accessible name of the navigation: "Tests in the current list". */
  label: string;
  position: number | null;
  total: number;
  /** Shown instead of the position when the item is not in the list. */
  outside: string;
  previous: (() => void) | null;
  next: (() => void) | null;
  previousLabel: string;
  nextLabel: string;
  /** Shortcut keys, previous then next. */
  keys: readonly [string, string];
}) {
  return (
    <nav class="pager" aria-label={label}>
      <button type="button" class="button pager-button" disabled={!previous} aria-keyshortcuts={keys[0]} onClick={previous ?? undefined}>
        <ChevronIcon class="chevron-back" />
        {previousLabel}
      </button>
      <span class="pager-position">{position === null ? outside : `${position} of ${total}`}</span>
      <button type="button" class="button pager-button" disabled={!next} aria-keyshortcuts={keys[1]} onClick={next ?? undefined}>
        {nextLabel}
        <ChevronIcon />
      </button>
    </nav>
  );
}
