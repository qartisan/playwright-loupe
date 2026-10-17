import type { Outcome, TestCase } from '../../schema/v1.js';
import { shownCategories } from './match.js';
import type { Sort, SortColumn, SortDirection } from './url.js';

/**
 * Order of the Tests view. Ties are broken by title, project, then repeat
 * index, always ascending, so the order is stable whatever the column.
 *
 * Pure functions, no DOM: unit-tested in Node.
 */

/** Status severity: failed first, skipped last. */
export const STATUS_SEVERITY: Record<Outcome, number> = { failed: 0, flaky: 1, passed: 2, skipped: 3 };

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function titlePath(test: TestCase): string {
  return [...test.suitePath, test.title].join(' › ');
}

/** Direction a column starts with when chosen: largest first for numbers, A → Z for text. */
export function initialDirection(column: SortColumn): SortDirection {
  return column === 'duration' || column === 'attempts' ? 'desc' : 'asc';
}

/** The sort after a click on a column header: the other direction on the same column, the initial one on another. */
export function nextSort(current: Sort, column: SortColumn): Sort {
  if (current.column === column) return { column, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  return { column, direction: initialDirection(column) };
}

/** Text columns, compared with the collator once per report, then as integer ranks. */
const TEXT_KEYS = {
  title: titlePath,
  project: (test: TestCase) => test.project,
  // Numeric collation: line 9 before line 12.
  file: (test: TestCase) => `${test.file}:${test.line}`,
  category: (test: TestCase) => shownCategories(test).primary,
} satisfies Partial<Record<SortColumn, (test: TestCase) => string | null>>;

type TextColumn = keyof typeof TEXT_KEYS;

/**
 * Collation ranks of a report's tests. Comparing strings with
 * Intl.Collator dominates the cost of a sort in browsers; the strings never
 * change, so they are ranked once and each sort compares integers.
 */
export interface SortRanks {
  text: Record<TextColumn, Map<TestCase, number | null>>;
  /** Position by title, project, then repeat index: the tie-breaker of every sort. */
  order: Map<TestCase, number>;
}

function rankBy(tests: readonly TestCase[], key: (test: TestCase) => string | null): Map<TestCase, number | null> {
  const values = [...new Set(tests.map(key).filter((value): value is string => value !== null))].sort(collator.compare);
  const rank = new Map(values.map((value, index) => [value, index]));
  return new Map(tests.map((test) => {
    const value = key(test);
    return [test, value === null ? null : (rank.get(value) ?? null)];
  }));
}

export function buildSortRanks(tests: readonly TestCase[]): SortRanks {
  const text = {
    title: rankBy(tests, TEXT_KEYS.title),
    project: rankBy(tests, TEXT_KEYS.project),
    file: rankBy(tests, TEXT_KEYS.file),
    category: rankBy(tests, TEXT_KEYS.category),
  };
  const rank = (column: TextColumn, test: TestCase): number => text[column].get(test) ?? 0;
  const ordered = [...tests].sort((a, b) => rank('title', a) - rank('title', b) || rank('project', a) - rank('project', b) || a.repeatEachIndex - b.repeatEachIndex);
  return { text, order: new Map(ordered.map((test, index) => [test, index])) };
}

/** A sort key; null (no category) always comes last. */
function sortKey(test: TestCase, column: SortColumn, ranks: SortRanks): number | null {
  switch (column) {
    case 'status':
      return STATUS_SEVERITY[test.outcome];
    case 'duration':
      return test.durationMs;
    case 'attempts':
      return test.attempts.length;
    default:
      return ranks.text[column].get(test) ?? null;
  }
}

function compareKeys(a: number | null, b: number | null, sign: number): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return sign * (a - b);
}

/**
 * Sorts tests by a column. `ranks` must cover every test of `tests`: build
 * them once from the report's tests; by default they are built from `tests`.
 */
export function sortTests(tests: readonly TestCase[], sort: Sort, ranks: SortRanks = buildSortRanks(tests)): TestCase[] {
  const sign = sort.direction === 'asc' ? 1 : -1;
  // Keys looked up once per test, not once per comparison.
  return tests
    .map((test) => ({ test, key: sortKey(test, sort.column, ranks), order: ranks.order.get(test) ?? 0 }))
    .sort((a, b) => compareKeys(a.key, b.key, sign) || a.order - b.order)
    .map(({ test }) => test);
}
