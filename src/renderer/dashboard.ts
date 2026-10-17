import { OUTCOMES } from '../schema/v1.js';
import type { Attempt, DimensionDefinition, LoupeError, LoupeReport, Outcome, Project, Stats, TestCase } from '../schema/v1.js';

/**
 * Dashboard and error group data, computed from the report alone (no model
 * change). Pure functions, no DOM: unit-tested in Node.
 */

/** Label used when an error has no category (`null` is reserved in v1). */
export const NO_CATEGORY = 'Uncategorized';

/** A failing attempt: neither the expected status nor skipped (docs/schema/v1.md, TestCase). */
export function isFailingAttempt(test: TestCase, attempt: Attempt): boolean {
  return attempt.status !== test.expectedStatus && attempt.status !== 'skipped';
}

export interface AffectedTest {
  test: TestCase;
  /** Indexes of the attempts where the error occurred, ascending. */
  attempts: number[];
}

/** Errors sharing a normalized signature, across tests and attempts. */
export interface ErrorGroup {
  signature: string;
  category: string;
  /** Full message of the first occurrence. */
  message: string;
  /** In report order; each test once. */
  tests: AffectedTest[];
  /** Affected tests that finally failed. */
  failed: number;
  /** Affected tests that passed on a retry. */
  flaky: number;
}

/**
 * Groups the errors of every failing attempt (failed and flaky tests) by
 * signature. Run errors are not included: they are not tied to a test.
 * Groups come in order of first occurrence.
 */
export function errorGroups(report: Pick<LoupeReport, 'tests'>): ErrorGroup[] {
  const groups = new Map<string, ErrorGroup>();
  for (const test of report.tests) {
    for (const attempt of test.attempts) {
      if (!isFailingAttempt(test, attempt)) continue;
      for (const error of attempt.errors) {
        let group = groups.get(error.signature);
        if (!group) {
          group = { signature: error.signature, category: error.category ?? NO_CATEGORY, message: error.message, tests: [], failed: 0, flaky: 0 };
          groups.set(error.signature, group);
        }
        const last = group.tests[group.tests.length - 1];
        if (last?.test === test) {
          if (!last.attempts.includes(attempt.index)) last.attempts.push(attempt.index);
        } else {
          group.tests.push({ test, attempts: [attempt.index] });
          if (test.outcome === 'failed') group.failed += 1;
          else if (test.outcome === 'flaky') group.flaky += 1;
        }
      }
    }
  }
  return [...groups.values()];
}

/** Groups by importance: most tests that finally failed, then most flaky tests, then first occurrence. The Errors view order. */
export function rankGroups(groups: readonly ErrorGroup[]): ErrorGroup[] {
  return groups
    .map((group, index) => ({ group, index }))
    .sort((a, b) => b.group.failed - a.group.failed || b.group.flaky - a.group.flaky || a.index - b.index)
    .map(({ group }) => group);
}

export function firstLine(text: string): string {
  return text.split('\n').find((line) => line.trim() !== '')?.trim() ?? '';
}

/** A generic matcher line, the same for every failure of that matcher: `Error: expect(locator).toBeVisible() failed`. */
const GENERIC_MATCHER = /^(?:Error: )?(?:expect(?:\.soft|\.poll)?\(\w+\)\.(?:not\.)?\w+\([^)]*\)(?: failed)?|Timed out \d+ms waiting for expect\(.*)$/;
/** `Locator: getByRole('button')`, as Playwright prints it under a failed locator assertion. */
const LOCATOR_LINE = /^\s*Locator:\s+(.+?)\s*$/m;
/** The response line of Playwright's fetch log (`← 429 Too Many Requests`), under a failed `toBeOK()`. */
const RESPONSE_LINE = /^\s*(?:- )?\u2190 (\d{3}\b.*?)\s*$/m;

/**
 * The line that best tells an error apart, for one-line summaries. When the
 * first line is a generic matcher line, the locator (`Locator: …`) or the
 * HTTP response status is more telling; otherwise the first line.
 */
export function errorHeadline(message: string): string {
  const first = firstLine(message);
  if (!GENERIC_MATCHER.test(first)) return first;
  const locator = LOCATOR_LINE.exec(message);
  if (locator) return `Locator: ${locator[1]}`;
  const response = RESPONSE_LINE.exec(message);
  if (response) return `\u2190 ${response[1]}`;
  return first;
}

/** One-line summary of a group: its headline, and the first affected test with how many others. */
export function groupSummary(group: ErrorGroup): { headline: string; firstTest: TestCase | null; others: number } {
  return { headline: errorHeadline(group.message), firstTest: group.tests[0]?.test ?? null, others: Math.max(0, group.tests.length - 1) };
}

/**
 * How many attempts of the affected tests failed with this error, when one of
 * them ran more than once: `failed on 2 of 2 attempts` (a test failing the
 * same way on its retry), `failed on 1 of 2 attempts` (the retry passed, or
 * failed differently). Several tests add up: `failed on 5 of 7 attempts`.
 * Null when every affected test ran once: the count would say nothing.
 */
export function groupAttempts(group: Pick<ErrorGroup, 'tests'>): string | null {
  if (!group.tests.some(({ test }) => test.attempts.length > 1)) return null;
  const failing = group.tests.reduce((sum, { attempts }) => sum + attempts.length, 0);
  const total = group.tests.reduce((sum, { test }) => sum + test.attempts.length, 0);
  return `failed on ${failing} of ${total} attempts`;
}

export interface CategoryCount {
  name: string;
  /** Distinct tests with an error of this category in a failing attempt. */
  tests: number;
  groups: ErrorGroup[];
}

/**
 * Failing tests per category, in the report's category order (rule order,
 * uncategorized last), categories without failing tests left out. A test with
 * errors of several categories counts in each.
 */
export function categoryCounts(report: Pick<LoupeReport, 'categories'>, groups: readonly ErrorGroup[]): CategoryCount[] {
  const byName = new Map<string, { tests: Set<TestCase>; groups: ErrorGroup[] }>();
  for (const group of groups) {
    let entry = byName.get(group.category);
    if (!entry) {
      entry = { tests: new Set(), groups: [] };
      byName.set(group.category, entry);
    }
    entry.groups.push(group);
    for (const { test } of group.tests) entry.tests.add(test);
  }
  const order = report.categories.map((category) => category.name);
  const names = [...order.filter((name) => byName.has(name)), ...[...byName.keys()].filter((name) => !order.includes(name))];
  return names.map((name) => {
    const entry = byName.get(name) as { tests: Set<TestCase>; groups: ErrorGroup[] };
    return { name, tests: entry.tests.size, groups: entry.groups };
  });
}

export type Verdict = 'passed' | 'failed' | 'flaky';

/**
 * Failed when a test failed, the run did not pass (timeout, interruption) or
 * has run errors: such a report is never presented as green. Flaky when a test
 * was flaky.
 */
export function verdict(report: Pick<LoupeReport, 'run'>): Verdict {
  const { stats, status, errors } = report.run;
  if (stats.failed > 0 || status !== 'passed' || errors.length > 0) return 'failed';
  return stats.flaky > 0 ? 'flaky' : 'passed';
}

export interface OutcomeShare {
  outcome: Outcome;
  count: number;
  /** Share of all tests, 0–1. */
  share: number;
}

/** Each outcome's share of the run, for the stacked bar; outcomes without tests left out. */
export function outcomeShares(stats: Stats): OutcomeShare[] {
  return OUTCOMES.filter((outcome) => stats[outcome] > 0).map((outcome) => ({
    outcome,
    count: stats[outcome],
    share: stats.total > 0 ? stats[outcome] / stats.total : 0,
  }));
}

/**
 * The pass rate, one definition everywhere (verdict, projects): passed /
 * (total − skipped). Skipped tests are left out; flaky tests do not count as
 * passed. Null when no test ran.
 */
export function passRate(stats: Stats): number | null {
  const ran = stats.total - stats.skipped;
  return ran > 0 ? stats.passed / ran : null;
}

/** Explains the pass rate wherever it is shown. */
export const PASS_RATE_HELP = 'Pass rate: passed / (total − skipped). Skipped tests are excluded; flaky tests do not count as passed.';

/** A pass rate as a whole percentage, never rounded up to 100% or down to 0% when it is not exact. */
export function formatPassRate(rate: number): string {
  const value = rate * 100;
  if (value > 99 && value < 100) return '99%';
  if (value > 0 && value < 1) return '<1%';
  return `${Math.round(value)}%`;
}

export interface ProjectSummary {
  project: Project;
  /** Passed tests among the tests that ran (skipped left out); null when none ran. Flaky tests do not count as passed. */
  passRate: number | null;
  /** Sum of the test durations: tests run in parallel, so it exceeds the wall-clock time. */
  durationMs: number;
}

export function projectSummaries(report: Pick<LoupeReport, 'projects' | 'tests'>): ProjectSummary[] {
  return report.projects
    .filter((project) => project.stats.total > 0)
    .map((project) => {
      const durationMs = report.tests.filter((test) => test.project === project.name).reduce((sum, test) => sum + test.durationMs, 0);
      return { project, passRate: passRate(project.stats), durationMs };
    });
}

export interface DimensionValueCounts {
  value: string;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  total: number;
  /** The dimension declares its values and this one is not among them. */
  unknown: boolean;
  /**
   * Other values of the dimension that differ from this one only by case
   * (`API` and `api`): likely duplicates. Never merged: Playwright tags are
   * case-sensitive.
   */
  caseVariants: string[];
}

export interface DimensionDistribution {
  definition: DimensionDefinition;
  /** Declared values first, in declaration order (even without tests), then other values sorted. */
  values: DimensionValueCounts[];
  /** Tests without a value for this dimension. */
  without: number;
}

export function dimensionDistributions(report: Pick<LoupeReport, 'dimensions' | 'tests'>): DimensionDistribution[] {
  return report.dimensions.map((definition) => {
    const counts = new Map<string, DimensionValueCounts>();
    const entry = (value: string): DimensionValueCounts => {
      let current = counts.get(value);
      if (!current) {
        const unknown = definition.values !== null && !definition.values.includes(value);
        current = { value, passed: 0, failed: 0, flaky: 0, skipped: 0, total: 0, unknown, caseVariants: [] };
        counts.set(value, current);
      }
      return current;
    };
    for (const value of definition.values ?? []) entry(value);
    let without = 0;
    for (const test of report.tests) {
      const values = test.dimensions[definition.name] ?? [];
      if (values.length === 0) without += 1;
      for (const value of new Set(values)) {
        const current = entry(value);
        current[test.outcome] += 1;
        current.total += 1;
      }
    }
    const declared = definition.values ?? [];
    const others = [...counts.keys()].filter((value) => !declared.includes(value)).sort((a, b) => a.localeCompare(b));
    const values = [...declared, ...others].map((value) => counts.get(value) as DimensionValueCounts);
    const variants = caseVariants(values.map((row) => row.value));
    for (const row of values) row.caseVariants = variants.get(row.value) ?? [];
    return { definition, values, without };
  });
}

/**
 * Up to this many values, a dimension shows one stacked bar per value; above,
 * a grid of tiles, which stays readable with dozens of values.
 */
export const DIMENSION_BARS_MAX = 8;

export type DimensionRepresentation = 'bars' | 'tiles';

export function dimensionRepresentation(distribution: Pick<DimensionDistribution, 'values'>): DimensionRepresentation {
  return distribution.values.length <= DIMENSION_BARS_MAX ? 'bars' : 'tiles';
}

/** The worst outcome of a value: failed, then flaky, then passed, then skipped; `none` when no test has it. */
export type WorstStatus = 'failed' | 'flaky' | 'passed' | 'skipped' | 'none';

export function worstStatus(row: Pick<DimensionValueCounts, 'failed' | 'flaky' | 'passed' | 'skipped'>): WorstStatus {
  if (row.failed > 0) return 'failed';
  if (row.flaky > 0) return 'flaky';
  if (row.passed > 0) return 'passed';
  return row.skipped > 0 ? 'skipped' : 'none';
}

const STATUS_RANK: Record<WorstStatus, number> = { failed: 0, flaky: 1, passed: 2, skipped: 3, none: 4 };

/**
 * Tiles order: problem values first (failed, then flaky), the most failed or
 * flaky tests first within each; then the others. Ties keep the
 * distribution order.
 */
export function tileOrder(values: readonly DimensionValueCounts[]): DimensionValueCounts[] {
  return values
    .map((row, index) => ({ row, index, status: worstStatus(row) }))
    .sort(
      (a, b) =>
        STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
        b.row.failed - a.row.failed ||
        b.row.flaky - a.row.flaky ||
        a.index - b.index,
    )
    .map(({ row }) => row);
}

/** Summary of a tile grid: `38 values · 36 all passed · 2 with failures`. Empty groups are left out. */
export function tileSummary(values: readonly DimensionValueCounts[]): string {
  const count = (status: WorstStatus): number => values.filter((row) => worstStatus(row) === status).length;
  const parts: Array<[number, string]> = [
    [count('passed'), 'all passed'],
    [count('failed'), 'with failures'],
    [count('flaky'), 'flaky'],
    [count('skipped'), 'skipped only'],
    [count('none'), 'without tests'],
  ];
  return [`${values.length} ${values.length === 1 ? 'value' : 'values'}`, ...parts.filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`)].join(' · ');
}

/** For each value, the other values equal to it ignoring case; values without such a twin are left out. */
export function caseVariants(values: readonly string[]): Map<string, string[]> {
  const byKey = new Map<string, string[]>();
  for (const value of new Set(values)) {
    const key = value.toLowerCase();
    byKey.set(key, [...(byKey.get(key) ?? []), value]);
  }
  const variants = new Map<string, string[]>();
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    for (const value of group) variants.set(value, group.filter((other) => other !== value));
  }
  return variants;
}

export interface FlakyTest {
  test: TestCase;
  /** First error of the first failing attempt; null when that attempt reported none. */
  error: LoupeError | null;
}

/** Flaky tests, with the error that made their failing attempt fail. */
export function flakyTests(report: Pick<LoupeReport, 'tests'>): FlakyTest[] {
  return report.tests
    .filter((test) => test.outcome === 'flaky')
    .map((test) => ({ test, error: test.attempts.find((attempt) => isFailingAttempt(test, attempt))?.errors[0] ?? null }));
}

/** The slowest tests by total duration across attempts, skipped tests and zero durations left out. */
export function slowestTests(report: Pick<LoupeReport, 'tests'>, limit = 10): TestCase[] {
  return report.tests
    .filter((test) => test.outcome !== 'skipped' && test.durationMs > 0)
    .map((test, index) => ({ test, index }))
    .sort((a, b) => b.test.durationMs - a.test.durationMs || a.index - b.index)
    .slice(0, limit)
    .map(({ test }) => test);
}

export interface SkippedTest {
  test: TestCase;
  /** `skip` or `fixme` when an annotation says why; null otherwise. */
  kind: 'skip' | 'fixme' | null;
  reason: string | null;
}

const SKIP_TYPES = ['skip', 'fixme'] as const;

/** Skipped tests, with the reason from their `skip` / `fixme` annotation (test or last attempt) when there is one. */
export function skippedTests(report: Pick<LoupeReport, 'tests'>): SkippedTest[] {
  return report.tests
    .filter((test) => test.outcome === 'skipped')
    .map((test) => {
      const annotations = [...test.annotations, ...(test.attempts[test.attempts.length - 1]?.annotations ?? [])];
      const skip = annotations.find((annotation) => (SKIP_TYPES as readonly string[]).includes(annotation.type));
      return {
        test,
        kind: skip ? (skip.type as SkippedTest['kind']) : null,
        reason: skip?.description?.trim() || null,
      };
    });
}
