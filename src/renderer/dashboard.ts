import type { Attempt, DimensionDefinition, LoupeReport, Project, TestCase } from '../schema/v1.js';

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

/**
 * The groups to look at first: most tests that finally failed, then most
 * flaky tests, then first occurrence.
 */
export function lookAtFirst(groups: readonly ErrorGroup[], limit = 5): ErrorGroup[] {
  return groups
    .map((group, index) => ({ group, index }))
    .sort((a, b) => b.group.failed - a.group.failed || b.group.flaky - a.group.flaky || a.index - b.index)
    .slice(0, limit)
    .map(({ group }) => group);
}

export function firstLine(text: string): string {
  return text.split('\n').find((line) => line.trim() !== '')?.trim() ?? '';
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
      const ran = project.stats.total - project.stats.skipped;
      const durationMs = report.tests.filter((test) => test.project === project.name).reduce((sum, test) => sum + test.durationMs, 0);
      return { project, passRate: ran > 0 ? project.stats.passed / ran : null, durationMs };
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
        current = { value, passed: 0, failed: 0, flaky: 0, skipped: 0, total: 0, unknown };
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
    return { definition, values: [...declared, ...others].map((value) => counts.get(value) as DimensionValueCounts), without };
  });
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
