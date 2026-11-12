/**
 * The history views' facts, computed from the embedded history block
 * (`<script id="loupe-history">`, `EmbeddedHistory`) and the current report.
 * Pure, no DOM, importing only schema types: the renderer uses it, and later
 * the core (a PR comment) can too.
 *
 * Two levels (brief 25, Step 0 decision 2):
 *
 * - **run level**, for the verdict delta: the runs that count in run-level
 *   statistics: full scope, not excluded, origin not `ide`; every run with
 *   `history.include: 'all'`;
 * - **test level**, for the failure states, Fixed and the counters: every
 *   result where the test ran (`P`, `F`, `K`; not `S`, not `-`) in a run that
 *   is not excluded. Partial and `ide` runs count. `include: 'all'` brings
 *   excluded runs back.
 *
 * "Flaky" keeps Playwright's meaning: passed on retry, within one run.
 */
import { EMBEDDED_HISTORY_VERSION, type EmbeddedHistory, type EmbeddedRun, type HistoryRun } from '../schema/history-v1.js';
import type { LoupeReport, Outcome } from '../schema/v1.js';
import { passRate } from './stats.js';

/** The failure states of a failing test, and Fixed, in the order the facet and the dashboard show them. */
export const HISTORY_STATES = ['new-failure', 'failed-again', 'still-failing', 'new-test', 'fixed'] as const;
export type HistoryState = (typeof HISTORY_STATES)[number];

/** A result code: an outcome code of the block, or `-` when the run has no result for the test. */
export type ResultCode = 'P' | 'F' | 'K' | 'S' | '-';

/** What the compute reads from the report: the current run. */
export type CurrentReport = {
  run: Pick<LoupeReport['run'], 'scope' | 'startedAt' | 'stats'>;
  projects: ReadonlyArray<Pick<LoupeReport['projects'][number], 'name' | 'retries'>>;
  tests: ReadonlyArray<{ outcome: Outcome; project: string }>;
};

/**
 * The block of `index.html`, checked: null for `null`, for anything that is
 * not a block of this version, or a block that does not fit the report (its
 * cells are not one per test and run). The renderer then shows no history.
 */
export function decodeHistory(value: unknown, testCount: number): EmbeddedHistory | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const block = value as Partial<EmbeddedHistory>;
  if (block.v !== EMBEDDED_HISTORY_VERSION) return null;
  if (!Array.isArray(block.runs) || typeof block.cells !== 'string' || !Array.isArray(block.failures) || typeof block.failureAttempts !== 'string') return null;
  if (!Array.isArray(block.attempts) || !Array.isArray(block.signatures) || !Array.isArray(block.others)) return null;
  if (block.include !== 'full' && block.include !== 'all') return null;
  if (block.current === null || typeof block.current !== 'object' || typeof block.skipped !== 'number') return null;
  if (block.cells.length !== testCount * block.runs.length) return null;
  if (block.others.some((other) => typeof other?.cells !== 'string' || other.cells.length !== testCount)) return null;
  return block as EmbeddedHistory;
}

/** Why a run does not count in run-level statistics; empty when it counts (or with `include: 'all'`). */
export type RunFlag = 'excluded' | 'ide' | 'partial';

/** Every reason a run is left out of run-level statistics by default, whatever `include` says. */
export function runFlags(run: { scope: HistoryRun['scope']; excluded: string | null; origin: HistoryRun['origin'] }): RunFlag[] {
  const flags: RunFlag[] = [];
  if (run.excluded !== null) flags.push('excluded');
  if (run.origin === 'ide') flags.push('ide');
  if (run.scope === 'partial') flags.push('partial');
  return flags;
}

/** Run level: the run counts in run-level statistics (the verdict delta). */
export function countsForRun(run: Parameters<typeof runFlags>[0], include: EmbeddedHistory['include']): boolean {
  return include === 'all' || runFlags(run).length === 0;
}

/** Test level: the run's results count for its tests' states and counters. Only an exclusion removes them. */
export function countsForTests(run: { excluded: string | null }, include: EmbeddedHistory['include']): boolean {
  return include === 'all' || run.excluded === null;
}

const OUTCOME_CODE: Record<Outcome, ResultCode> = { passed: 'P', failed: 'F', flaky: 'K', skipped: 'S' };

/** The test ran: a pass, a failure, or a pass on retry. */
const ran = (code: ResultCode): boolean => code === 'P' || code === 'F' || code === 'K';

/**
 * Facts about a test's results, side by side, with no score and no
 * threshold: over its test-level comparable results in the window, plus the
 * current run when it counts.
 */
export interface Counters {
  /** Results whose final status is a failure. */
  failures: number;
  /** Changes between consecutive results, pass ↔ fail; flaky counts as a pass. */
  statusChanges: number;
  /** Flaky results: passed on retry, within one run. */
  passedOnRetry: number;
  /** Results counted. */
  considered: number;
}

/** Counters over results in run order, oldest first. */
export function countResults(codes: readonly ResultCode[]): Counters {
  const counters: Counters = { failures: 0, statusChanges: 0, passedOnRetry: 0, considered: 0 };
  let previous: boolean | null = null;
  for (const code of codes) {
    if (!ran(code)) continue;
    const failed = code === 'F';
    counters.considered++;
    if (failed) counters.failures++;
    if (code === 'K') counters.passedOnRetry++;
    if (previous !== null && previous !== failed) counters.statusChanges++;
    previous = failed;
  }
  return counters;
}

/**
 * The state of a test from its current outcome and its earlier comparable
 * results (oldest first). For a failing test, exactly one of the four
 * failure states; Fixed for a test that passes (or is flaky) after a
 * failure; null otherwise. A "failed attempt" is an `F` or `K` result: a
 * flaky result had one. An expected failure (`test.fail()`) is a pass.
 */
export function stateOf(current: Outcome, past: readonly ResultCode[]): HistoryState | null {
  const comparable = past.filter(ran);
  const last = comparable[comparable.length - 1];
  if (current === 'failed') {
    if (last === undefined) return 'new-test';
    if (!comparable.some((code) => code === 'F' || code === 'K')) return 'new-failure';
    return last === 'F' ? 'still-failing' : 'failed-again';
  }
  return (current === 'passed' || current === 'flaky') && last === 'F' ? 'fixed' : null;
}

export interface TestHistory {
  /** Null when the test has no state, or when states are not shown (every earlier run excluded). */
  state: HistoryState | null;
  counters: Counters;
  /** Earlier test-level comparable results: the N of "no failure in its last N runs". */
  earlier: number;
  /** Every run of the window and the current run had 0 retries for the test's project. */
  noRetries: boolean;
}

/** Why no test state is shown. */
export type NoStatesReason = 'first-run' | 'all-excluded' | 'all-skipped';

/** Why the verdict shows no delta. */
export type NoDeltaReason = 'current-excluded' | 'current-ide' | 'current-partial' | 'no-earlier-run';

export interface RunDelta {
  /** The previous run of the stream that counts at run level. */
  previous: EmbeddedRun;
  /** Pass rate change in percentage points; null when either run has no test that ran. */
  passRatePoints: number | null;
  /** Change in failed tests. */
  failed: number;
}

export interface HistoryAnalysis {
  history: EmbeddedHistory;
  /** One entry per test of the report, in report order. */
  tests: TestHistory[];
  /** Tests in each state; all zero when states are not shown. */
  counts: Record<HistoryState, number>;
  /** False when the window holds no earlier result to compare with (see `noStates`): no states, one run-level line. */
  statesShown: boolean;
  /**
   * Why no test state is shown; null when they are. `first-run`: the stream
   * has no earlier run and nothing was skipped (a new stream, other streams
   * possibly known): every failing test would be "New test", which says
   * nothing and suggests new tests when other streams know them; "New test"
   * is for a test without results in a stream that has earlier runs.
   * `all-excluded`: every earlier run of the stream is excluded. `all-skipped`: every run file of
   * the window was skipped (a newer history format, corrupt or unreadable),
   * so the tests' past is unreadable, not empty: "New test" would be wrong.
   */
  noStates: NoStatesReason | null;
  delta: RunDelta | null;
  /** Why there is no delta; null when there is one. */
  noDelta: NoDeltaReason | null;
  /**
   * Runs of the window written with another signature version: their
   * statuses count, their errors are not compared. `before` is the start of
   * the first run after them (the current run when they are the newest).
   */
  signatureBreak: { before: string } | null;
  /** Run files of the window that could not be used (newer Loupe, corrupt, unreadable). */
  skipped: number;
}

/** Everything the history views need, computed once at load. */
export function analyzeHistory(history: EmbeddedHistory, report: CurrentReport): HistoryAnalysis {
  const { runs, include } = history;
  const width = runs.length;
  const forTests = runs.map((run) => countsForTests(run, include));
  // An empty window: a new stream, or one whose files were all skipped. Either way, nothing to compare with.
  const noStates: NoStatesReason | null = width === 0 ? (history.skipped > 0 ? 'all-skipped' : 'first-run') : forTests.some(Boolean) ? null : 'all-excluded';
  const statesShown = noStates === null;
  const currentForTests = countsForTests(history.current, include);

  // Projects with retries somewhere in the window or now: their tests have evidence of retries. A project absent from a run gives none.
  const withRetries = new Set<string>();
  for (const run of runs) for (const [name, retries] of run.projects) if (retries > 0) withRetries.add(name);
  for (const project of report.projects) if (project.retries > 0) withRetries.add(project.name);

  const counts = Object.fromEntries(HISTORY_STATES.map((state) => [state, 0])) as Record<HistoryState, number>;
  const tests = report.tests.map((test, index): TestHistory => {
    const past: ResultCode[] = [];
    for (let run = 0; run < width; run++) {
      if (forTests[run]) past.push(history.cells[index * width + run] as ResultCode);
    }
    const current = OUTCOME_CODE[test.outcome];
    // The current run joins the counters unless it is excluded; its state is computed either way: it compares this run with the past.
    const counters = countResults(currentForTests ? [...past, current] : past);
    const state = statesShown ? stateOf(test.outcome, past) : null;
    if (state !== null) counts[state]++;
    return { state, counters, earlier: past.filter(ran).length, noRetries: !withRetries.has(test.project) };
  });

  return { history, tests, counts, statesShown, noStates, ...runDelta(history, report), signatureBreak: signatureBreak(runs, report.run.startedAt), skipped: history.skipped };
}

/** The verdict delta against the previous run counting at run level, or why there is none. */
export function runDelta(history: EmbeddedHistory, report: Pick<CurrentReport, 'run'>): { delta: RunDelta | null; noDelta: NoDeltaReason | null } {
  const current = { scope: report.run.scope, excluded: history.current.excluded, origin: history.current.origin };
  if (!countsForRun(current, history.include)) {
    const [flag] = runFlags(current);
    return { delta: null, noDelta: flag === 'excluded' ? 'current-excluded' : flag === 'ide' ? 'current-ide' : 'current-partial' };
  }
  const previous = [...history.runs].reverse().find((run) => countsForRun(run, history.include));
  if (previous === undefined) return { delta: null, noDelta: 'no-earlier-run' };
  const now = passRate(report.run.stats);
  const before = passRate(previous.stats);
  return {
    delta: { previous, passRatePoints: now === null || before === null ? null : (now - before) * 100, failed: report.run.stats.failed - previous.stats.failed },
    noDelta: null,
  };
}

function signatureBreak(runs: readonly EmbeddedRun[], currentStart: string): { before: string } | null {
  let newestOld = -1;
  runs.forEach((run, index) => {
    if (!run.sameSignatures) newestOld = index;
  });
  if (newestOld === -1) return null;
  return { before: runs[newestOld + 1]?.startedAt ?? currentStart };
}

/** A test's result in one run of the window: what the strip shows. */
export interface HistoryCell {
  /** Column of the window, oldest first. */
  index: number;
  run: EmbeddedRun;
  code: ResultCode;
  /** One status per attempt (`FFP`), as `HistoryTest.a`: from the block, or implied by the code. Null when the test has no result. */
  attempts: string | null;
  /** Why the run is left out of run-level statistics by default. */
  flags: RunFlag[];
  /** The result decides the test's state and counters. */
  counts: boolean;
  /** The first error of the first failed attempt: null when the result has none to show. `compared` is false for another signature version. */
  failure: { category: string | null; extract: string | null; compared: boolean } | null;
}

/**
 * Per-test lookups into the block, built once: where each failing test's
 * signatures and attempts start, and the attempts the codes do not imply.
 */
export interface HistoryIndex {
  failureRows: Map<number, { sigs: number[]; attempts: string[] }>;
  attempts: Map<number, string>;
}

export function indexHistory(history: EmbeddedHistory): HistoryIndex {
  const width = history.runs.length;
  const attemptList = history.failureAttempts === '' ? [] : history.failureAttempts.split(' ');
  const failureRows = new Map<number, { sigs: number[]; attempts: string[] }>();
  let offset = 0;
  for (const [test, ...sigs] of history.failures) {
    if (test === undefined) continue;
    failureRows.set(test, { sigs, attempts: attemptList.slice(offset, offset + sigs.length) });
    offset += sigs.length;
  }
  return { failureRows, attempts: new Map(history.attempts.map(([test, run, attempts]) => [test * width + run, attempts])) };
}

/** The strip of one test: one cell per run of the window, oldest first. */
export function testCells(history: EmbeddedHistory, index: HistoryIndex, test: number): HistoryCell[] {
  const width = history.runs.length;
  const row = index.failureRows.get(test);
  let failing = 0;
  return history.runs.map((run, column): HistoryCell => {
    const code = history.cells[test * width + column] as ResultCode;
    const base = { index: column, run, code, flags: runFlags(run), counts: ran(code) && countsForTests(run, history.include) };
    if (code === 'F' || code === 'K') {
      const ordinal = failing++;
      const sig = row?.sigs[ordinal] ?? -1;
      const signature = sig >= 0 ? history.signatures[sig] : undefined;
      return {
        ...base,
        attempts: row?.attempts[ordinal] || null,
        failure: signature ? { category: signature[1], extract: signature[2], compared: true } : run.sameSignatures ? null : { category: null, extract: null, compared: false },
      };
    }
    const attempts = index.attempts.get(test * width + column) ?? (code === 'P' || code === 'S' ? code : null);
    return { ...base, attempts, failure: null };
  });
}

/** The latest result of a test in each other stream, newest stream run first. */
export function otherStreams(history: EmbeddedHistory, test: number): Array<{ stream: HistoryRun['stream']; id: string; startedAt: string; code: ResultCode }> {
  return history.others.map((other) => ({ stream: other.stream, id: other.id, startedAt: other.startedAt, code: (other.cells[test] ?? '-') as ResultCode }));
}
