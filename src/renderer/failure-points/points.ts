import type { TestCase } from '../../schema/v1.js';
import { NO_CATEGORY, isFailingAttempt } from '../dashboard.js';
import { isLibraryFrame, parseStack, relativeToRoot } from './frames.js';
import { MAX_POINTS, MIN_POINT_FILES, MIN_POINT_GROUPS, MIN_POINT_TESTS } from './thresholds.js';

/**
 * Common failure points: functions of the user's code (not test files) that
 * appear in the stacks of failures in several spec files and error groups.
 * A lead, not a diagnosis: a shared helper also shows up when unrelated
 * failures go through it.
 *
 * Input: every error of every failing attempt (the rule of the error groups
 * and the category facet, flaky tests and interrupted attempts included).
 * Derived from the report alone (no model change), computed once per report.
 * See "Common failure points" in the README.
 *
 * Pure functions, no DOM: unit-tested in Node.
 */

export interface FailurePointRef {
  /** `<path relative to the root dir>#<function>`: the facet value. */
  key: string;
  /** Relative to the root dir, `../` segments when outside it. */
  file: string;
  fn: string;
}

export interface FailurePoint extends FailurePointRef {
  /** Lines seen in the stacks, ascending. */
  lines: number[];
  /** Distinct tests (file + suite path + title: a test run in several projects counts once). */
  tests: number;
  /** Of `tests`: failed in at least one project. */
  failed: number;
  /** Of `tests`: flaky, and failed in no project. */
  flaky: number;
  files: number;
  /** Signatures of the errors whose stack holds the point. */
  signatures: string[];
  /** Categories of those errors, in order of first occurrence (sorted for display by the report's category order). */
  categories: string[];
  /** Functions folded under this point: reached only through it. */
  via: FailurePointRef[];
}

export interface FailurePoints {
  /** The directory the report's test files are relative to; null when no frame shows it. */
  root: string | null;
  /** Shown points, after thresholds and folding, ranked, at most `MAX_POINTS`. */
  points: FailurePoint[];
  /** For each test with a shown point in the stack of one of its failing attempts, those point keys. */
  byTest: ReadonlyMap<TestCase, readonly string[]>;
}

export const NO_FAILURE_POINTS: FailurePoints = { root: null, points: [], byTest: new Map() };

export function identityKey(test: Pick<TestCase, 'file' | 'suitePath' | 'title'>): string {
  return [test.file, ...test.suitePath, test.title].join('\u0000');
}

interface ErrorFrames {
  test: TestCase;
  signature: string;
  category: string;
  frames: ReturnType<typeof parseStack>;
}

function failingErrors(tests: readonly TestCase[]): ErrorFrames[] {
  const errors: ErrorFrames[] = [];
  for (const test of tests) {
    for (const attempt of test.attempts) {
      if (!isFailingAttempt(test, attempt)) continue;
      for (const error of attempt.errors) {
        errors.push({ test, signature: error.signature, category: error.category ?? NO_CATEGORY, frames: parseStack(error.stack) });
      }
    }
  }
  return errors;
}

/**
 * The root dir: frame paths that end with the failing test's own `file`,
 * minus that `file`. The most common candidate over the report; on a tie,
 * the shortest, then the first in code point order. Null when no frame
 * points at its test's file.
 */
export function deriveRoot(errors: ReadonlyArray<Pick<ErrorFrames, 'test' | 'frames'>>): string | null {
  const votes = new Map<string, number>();
  for (const { test, frames } of errors) {
    const suffix = `/${test.file}`;
    for (const frame of frames) {
      if (!frame.path.endsWith(suffix)) continue;
      const root = frame.path.slice(0, frame.path.length - test.file.length);
      votes.set(root, (votes.get(root) ?? 0) + 1);
    }
  }
  let best: [string, number] | null = null;
  for (const entry of votes) {
    if (
      best === null ||
      entry[1] > best[1] ||
      (entry[1] === best[1] && (entry[0].length < best[0].length || (entry[0].length === best[0].length && entry[0] < best[0])))
    ) {
      best = entry;
    }
  }
  return best?.[0] ?? null;
}

interface Candidate extends FailurePointRef {
  lines: Set<number>;
  /** Identity → failed, flaky or other. */
  identities: Map<string, 'failed' | 'flaky' | 'other'>;
  files: Set<string>;
  signatures: Set<string>;
  categories: Set<string>;
  /** Indexes of the stacks holding the point. */
  stacks: number[];
}

function rankCandidates(a: Candidate, b: Candidate): number {
  return b.identities.size - a.identities.size || b.files.size - a.files.size || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

const OUTCOME_RANK = { failed: 0, flaky: 1, other: 2 } as const;

/** Computes the common failure points of a report. Prefer `failurePoints`, which caches them. */
export function computeFailurePoints(report: { tests: readonly TestCase[] }): FailurePoints {
  const errors = failingErrors(report.tests);
  const root = deriveRoot(errors);
  if (root === null) return { ...NO_FAILURE_POINTS, root: null };
  const testFiles = new Set(report.tests.map((test) => test.file));

  const candidates = new Map<string, Candidate>();
  /** Per stack: point key → first (innermost) frame index. */
  const stacks: Array<Map<string, number>> = [];
  const keysByTest = new Map<TestCase, Set<string>>();

  for (const { test, signature, category, frames } of errors) {
    const positions = new Map<string, number>();
    const stackIndex = stacks.length;
    frames.forEach((frame, index) => {
      if (frame.fn === null || isLibraryFrame(frame.path)) return;
      const file = relativeToRoot(frame.path, root);
      if (testFiles.has(file)) return;
      const key = `${file}#${frame.fn}`;
      let candidate = candidates.get(key);
      if (!candidate) {
        candidate = { key, file, fn: frame.fn, lines: new Set(), identities: new Map(), files: new Set(), signatures: new Set(), categories: new Set(), stacks: [] };
        candidates.set(key, candidate);
      }
      if (frame.line !== null) candidate.lines.add(frame.line);
      if (positions.has(key)) return;
      positions.set(key, index);
      const identity = identityKey(test);
      const outcome = test.outcome === 'failed' ? 'failed' : test.outcome === 'flaky' ? 'flaky' : 'other';
      const previous = candidate.identities.get(identity);
      if (previous === undefined || OUTCOME_RANK[outcome] < OUTCOME_RANK[previous]) candidate.identities.set(identity, outcome);
      candidate.files.add(test.file);
      candidate.signatures.add(signature);
      candidate.categories.add(category);
      candidate.stacks.push(stackIndex);
      let keys = keysByTest.get(test);
      if (!keys) keysByTest.set(test, (keys = new Set()));
      keys.add(key);
    });
    stacks.push(positions);
  }

  const kept = [...candidates.values()]
    .filter((point) => point.identities.size >= MIN_POINT_TESTS && point.files.size >= MIN_POINT_FILES && point.signatures.size >= MIN_POINT_GROUPS)
    .sort(rankCandidates);

  // Folding: X goes under Y when the tests of X are a subset of those of Y
  // and, in every stack holding X, Y is a caller (a deeper frame). Among
  // several such Y: the fewest tests, then the outermost, then the ranking.
  const foldedInto = new Map<string, Candidate>();
  for (const inner of kept) {
    let target: Candidate | null = null;
    let targetDepth = -1;
    const firstStack = stacks[inner.stacks[0] as number] as Map<string, number>;
    for (const outer of kept) {
      if (outer === inner || outer.identities.size < inner.identities.size) continue;
      if (![...inner.identities.keys()].every((identity) => outer.identities.has(identity))) continue;
      const isCaller = inner.stacks.every((index) => {
        const stack = stacks[index] as Map<string, number>;
        const outerAt = stack.get(outer.key);
        return outerAt !== undefined && outerAt > (stack.get(inner.key) as number);
      });
      if (!isCaller) continue;
      const depth = firstStack.get(outer.key) as number;
      if (target === null || outer.identities.size < target.identities.size || (outer.identities.size === target.identities.size && depth > targetDepth)) {
        target = outer;
        targetDepth = depth;
      }
    }
    if (target) foldedInto.set(inner.key, target);
  }
  // A caller cannot be folded under its callee, so chains end.
  const outermost = (point: Candidate): Candidate => {
    const target = foldedInto.get(point.key);
    return target ? outermost(target) : point;
  };

  const shown = kept.filter((point) => !foldedInto.has(point.key)).slice(0, MAX_POINTS);
  const points = shown.map((point): FailurePoint => {
    const outcomes = [...point.identities.values()];
    return {
      key: point.key,
      file: point.file,
      fn: point.fn,
      lines: [...point.lines].sort((a, b) => a - b),
      tests: point.identities.size,
      failed: outcomes.filter((outcome) => outcome === 'failed').length,
      flaky: outcomes.filter((outcome) => outcome === 'flaky').length,
      files: point.files.size,
      signatures: [...point.signatures],
      categories: [...point.categories],
      via: kept.filter((inner) => foldedInto.has(inner.key) && outermost(inner) === point).map(({ key, file, fn }) => ({ key, file, fn })),
    };
  });

  const shownKeys = points.map((point) => point.key);
  const byTest = new Map<TestCase, string[]>();
  for (const [test, keys] of keysByTest) {
    const values = shownKeys.filter((key) => keys.has(key));
    if (values.length > 0) byTest.set(test, values);
  }
  return { root, points, byTest };
}

// Tests are immutable once loaded: their points are computed once.
const cache = new WeakMap<readonly TestCase[], FailurePoints>();

/** The common failure points of a report, computed once per test list. */
export function failurePoints(report: { tests: readonly TestCase[] }): FailurePoints {
  let points = cache.get(report.tests);
  if (!points) {
    points = computeFailurePoints(report);
    cache.set(report.tests, points);
  }
  return points;
}
