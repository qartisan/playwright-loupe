import type { Outcome, TestCase } from '../../schema/v1.js';
import { shownCategories } from './match.js';
import type { Sort, SortColumn, SortDirection, SortKey } from './url.js';

/**
 * Order of the Tests view. By default, declaration order, the sidebar's:
 * project (report order), file, line, column. A column header sorts by that
 * column; ties are always broken ascending, so the order is stable: by
 * declaration order for the status column, by title, project, then repeat
 * index for the other columns.
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
  /** Position by title, project, then repeat index: the tie-breaker of every column but status. */
  order: Map<TestCase, number>;
  /** Position by project (report order), file, line, column, then title and repeat index: the tie-breaker of the status column. */
  declaration: Map<TestCase, number>;
}

function rankBy(tests: readonly TestCase[], key: (test: TestCase) => string | null): Map<TestCase, number | null> {
  const values = [...new Set(tests.map(key).filter((value): value is string => value !== null))].sort(collator.compare);
  const rank = new Map(values.map((value, index) => [value, index]));
  return new Map(tests.map((test) => {
    const value = key(test);
    return [test, value === null ? null : (rank.get(value) ?? null)];
  }));
}

/**
 * `projects`: project names in report order (the sidebar's); projects not
 * listed come after, in order of first appearance.
 */
export function buildSortRanks(tests: readonly TestCase[], projects: readonly string[] = []): SortRanks {
  const text = {
    title: rankBy(tests, TEXT_KEYS.title),
    project: rankBy(tests, TEXT_KEYS.project),
    file: rankBy(tests, TEXT_KEYS.file),
    category: rankBy(tests, TEXT_KEYS.category),
  };
  const rank = (column: TextColumn, test: TestCase): number => text[column].get(test) ?? 0;
  const ordered = [...tests].sort((a, b) => rank('title', a) - rank('title', b) || rank('project', a) - rank('project', b) || a.repeatEachIndex - b.repeatEachIndex);
  const projectRank = new Map<string, number>(projects.map((name, index) => [name, index]));
  for (const test of tests) if (!projectRank.has(test.project)) projectRank.set(test.project, projectRank.size);
  const declared = [...tests].sort(
    (a, b) =>
      (projectRank.get(a.project) ?? 0) - (projectRank.get(b.project) ?? 0) ||
      collator.compare(a.file, b.file) ||
      a.line - b.line ||
      a.column - b.column ||
      rank('title', a) - rank('title', b) ||
      a.repeatEachIndex - b.repeatEachIndex,
  );
  return { text, order: new Map(ordered.map((test, index) => [test, index])), declaration: new Map(declared.map((test, index) => [test, index])) };
}

/** A sort key; null (no category) always comes last. */
function sortKey(test: TestCase, column: SortKey, ranks: SortRanks): number | null {
  switch (column) {
    case 'declaration':
      return ranks.declaration.get(test) ?? 0;
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
  const tieBreaker = sort.column === 'status' || sort.column === 'declaration' ? ranks.declaration : ranks.order;
  // Keys looked up once per test, not once per comparison.
  return tests
    .map((test) => ({ test, key: sortKey(test, sort.column, ranks), order: tieBreaker.get(test) ?? 0 }))
    .sort((a, b) => compareKeys(a.key, b.key, sign) || a.order - b.order)
    .map(({ test }) => test);
}
