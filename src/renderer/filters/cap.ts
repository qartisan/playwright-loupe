/**
 * Render cap of the Tests view: the first rows of the filtered and sorted
 * list, more on demand. The browser lays out every rendered row, so a few
 * thousand rows make each filter or sort change slow; the cap keeps it fast.
 *
 * Pure functions, no DOM: unit-tested in Node.
 */

/** Rows shown at first, and added by "Show more". */
export const CAP_STEP = 500;

const numbers = new Intl.NumberFormat('en-US');

function count(value: number): string {
  return numbers.format(value);
}

/** Rows to render: the cap, never more than the matching tests. */
export function cappedLength(matched: number, limit: number): number {
  return Math.min(matched, Math.max(limit, 0));
}

/**
 * The result count, announced to screen readers:
 * `340 tests`, `12 of 340 tests`, `Showing 500 of 5,000 tests`,
 * `Showing 500 of 4,200 matching tests (5,000 in total)`.
 */
export function resultSummary(shown: number, matched: number, total: number): string {
  const noun = (value: number): string => (value === 1 ? 'test' : 'tests');
  if (shown < matched) {
    return matched === total
      ? `Showing ${count(shown)} of ${count(total)} ${noun(total)}`
      : `Showing ${count(shown)} of ${count(matched)} matching ${noun(matched)} (${count(total)} in total)`;
  }
  return matched === total ? `${count(total)} ${noun(total)}` : `${count(matched)} of ${count(total)} ${noun(total)}`;
}
