import type { HistoryRun } from '../schema/history-v1.js';
import type { LoupeReport, TestCase } from '../schema/v1.js';
import {
  analyzeHistory,
  decodeHistory,
  indexHistory,
  type Counters,
  type HistoryAnalysis,
  type HistoryCell,
  type HistoryIndex,
  type HistoryState,
  type NoDeltaReason,
  type NoStatesReason,
  type ResultCode,
  type TestHistory,
} from '../shared/history.js';
import { plural } from './format.js';

/**
 * The run history of the report, from the `loupe-history` block of the page:
 * decoded and analysed once, at load (src/shared/history.ts). Null without
 * history (no block, `null`, a block that does not fit the report): then the
 * report shows no history zone at all.
 */
export interface ReportHistory {
  analysis: HistoryAnalysis;
  /** The history of each test of the report. */
  byTest: ReadonlyMap<TestCase, TestHistory>;
  /** Each test's row in the block (its index in the report), for its strip and other streams. */
  rows: ReadonlyMap<TestCase, number>;
  /** Lookups into the block for the strips, built once. */
  index: HistoryIndex;
}

/** Never throws: anything unreadable is no history. */
export function loadHistory(text: string | null | undefined, report: LoupeReport): ReportHistory | null {
  let value: unknown;
  try {
    value = JSON.parse(text ?? '');
  } catch {
    return null;
  }
  const block = decodeHistory(value, report.tests.length);
  if (block === null) return null;
  const analysis = analyzeHistory(block, report);
  return {
    analysis,
    byTest: new Map(report.tests.map((test, index) => [test, analysis.tests[index] as TestHistory])),
    rows: new Map(report.tests.map((test, index) => [test, index])),
    index: indexHistory(block),
  };
}

export const STATE_LABEL: Record<HistoryState, string> = {
  'new-failure': 'New failure',
  'failed-again': 'Failed again',
  'still-failing': 'Still failing',
  'new-test': 'New test',
  fixed: 'Fixed',
};

/** What each state means, for tooltips: facts the window supports, never a cause. */
export const STATE_HELP: Record<HistoryState, string> = {
  'new-failure': 'Failing now, with no failure in its earlier results in this stream',
  'failed-again': 'Failing now; its last earlier result passed, and an earlier one failed',
  'still-failing': 'Failing now, and in its last earlier result',
  'new-test': 'Failing now, with no earlier result in this stream, which has earlier runs',
  fixed: 'Passing now; its last earlier result failed',
};

/**
 * The id of a state's definition in the view's "What the history states
 * mean" list (HistoryHelp): markers and links point to it with
 * aria-describedby, so the definition is read on focus. One list per view.
 */
export function stateHelpId(state: HistoryState): string {
  return `history-help-${state}`;
}

/** "+3 pts", "−1.5 pts", "no change": the pass rate change, in percentage points. */
export function formatPoints(points: number): string {
  const rounded = Math.round(points * 10) / 10;
  if (rounded === 0) return 'no change';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)} ${Math.abs(rounded) === 1 ? 'pt' : 'pts'}`;
}

/** "2 fewer failed tests", "1 more failed test", "as many failed tests". */
export function formatFailedChange(change: number): string {
  if (change === 0) return 'as many failed tests';
  return plural(Math.abs(change), `${change > 0 ? 'more' : 'fewer'} failed test`);
}

/** "3 new failures", "1 new test", "2 still failing", "1 fixed". */
export function stateCount(state: HistoryState, count: number): string {
  return state === 'new-failure' || state === 'new-test' ? plural(count, STATE_LABEL[state].toLowerCase()) : `${count} ${STATE_LABEL[state].toLowerCase()}`;
}

/** An origin in words: "CI", "local", "IDE". */
export const ORIGIN_TEXT: Record<HistoryRun['origin'], string> = { ci: 'CI', local: 'local', ide: 'IDE' };

/** The stream, as its key parts in words: "staging, CI", "default environment, IDE", "staging, CI, branch main". */
export function streamName(stream: HistoryRun['stream']): string {
  return Object.entries(stream)
    .map(([part, value]) => {
      if (part === 'origin') return ORIGIN_TEXT[value as HistoryRun['origin']] ?? value ?? 'no origin';
      if (part === 'branch') return value === null || value === undefined ? 'no branch' : `branch ${value}`;
      return value === 'default' ? 'default environment' : (value ?? 'no environment');
    })
    .join(', ');
}

const STREAM_PART_TEXT: Record<string, string> = { environment: 'an environment', origin: 'an origin (CI, local, IDE)', branch: 'a branch' };

/** What a stream is, from the parts of its key: "A stream is an environment plus an origin (CI, local, IDE); each has its own history." */
export function streamDefinition(stream: HistoryRun['stream']): string {
  const parts = Object.keys(stream).map((part) => STREAM_PART_TEXT[part] ?? part);
  return `A stream is ${parts.join(' plus ')}; each has its own history.`;
}

export const NO_STATES_TEXT: Record<NoStatesReason, string> = {
  'first-run': 'First run of this stream: nothing to compare yet.',
  'all-skipped': 'The earlier runs of this stream could not be read (a newer history format, or unreadable files): nothing to compare.',
  'all-excluded': "Every earlier run of this stream is excluded; history.include: 'all' counts them.",
};

export function noDeltaText(reason: NoDeltaReason, excluded: string | null, include: 'full' | 'all'): string {
  switch (reason) {
    case 'current-excluded':
      return `This run is excluded${excluded ? ` (${excluded})` : ''}: it is not compared with earlier runs.`;
    case 'current-ide':
      return 'This run comes from the IDE (VS Code extension, UI or watch mode): it is not compared with earlier runs.';
    case 'current-partial':
      return 'This run is partial: it is not compared with earlier runs.';
    case 'no-earlier-run':
      return include === 'all' ? 'No earlier run in this stream to compare with.' : 'No earlier full run in this stream to compare with.';
  }
}

/** A result in a strip or another stream, in words: "passed", "failed", "flaky (passed on retry)", "skipped", "no result". */
export const RESULT_TEXT: Record<ResultCode, string> = {
  P: 'passed',
  F: 'failed',
  K: 'flaky (passed on retry)',
  S: 'skipped',
  '-': 'no result',
};

const ATTEMPT_TEXT: Record<string, string> = { P: 'passed', F: 'failed', T: 'timed out', S: 'skipped', I: 'interrupted' };

/** "2 attempts: failed, passed"; "1 attempt: timed out"; null without attempts. */
export function attemptsText(attempts: string | null): string | null {
  if (!attempts) return null;
  return `${plural(attempts.length, 'attempt')}: ${[...attempts].map((code) => ATTEMPT_TEXT[code] ?? code).join(', ')}`;
}

/** The last status of the first failing attempt, as the cell's name ends with it: "Timeout" for `T`. */
function failureWord(cell: Pick<HistoryCell, 'attempts' | 'failure'>): string | null {
  if (cell.failure?.category) return cell.failure.category;
  return cell.attempts?.includes('T') ? 'timed out' : null;
}

/**
 * How a run drawn apart is used, in one sentence; null for an ordinary run
 * (full, not excluded, outside the IDE). Run comparisons (the verdict delta)
 * use only ordinary runs, a test's history every run but excluded ones;
 * `history.include: 'all'` uses every run for both.
 */
export function cellUse(cell: Pick<HistoryCell, 'run' | 'flags'>, include: 'full' | 'all'): string | null {
  const { run, flags } = cell;
  const all = "used, because history.include is 'all'";
  if (flags.includes('excluded')) return `Excluded run${run.excluded ? ` (${run.excluded})` : ''}: ${include === 'all' ? all : "not used in this test's history"}`;
  const partial = flags.includes('partial');
  const ide = flags.includes('ide');
  if (!partial && !ide) return null;
  const reasons = partial && run.scopeReasons.length > 0 ? ` (${run.scopeReasons.join(', ')})` : '';
  const subject = partial ? `Partial run${ide ? ' from the IDE' : ''}${reasons}` : 'Run from the IDE';
  return `${subject}: ${include === 'all' ? all : "used in this test's history, not in run comparisons"}`;
}

/**
 * The full accessible name of a strip cell: "21 Oct 2026, 18:45, CI,
 * failed, Timeout", then how the run is used when it is drawn apart
 * (cellUse). `date` is the run's start as the report formats it.
 */
export function cellName(cell: Pick<HistoryCell, 'run' | 'code' | 'attempts' | 'failure' | 'flags'>, date: string, include: 'full' | 'all'): string {
  const failure = cell.code === 'F' || cell.code === 'K' ? failureWord(cell) : null;
  const use = cellUse(cell, include);
  return [date, ORIGIN_TEXT[cell.run.origin], RESULT_TEXT[cell.code], ...(failure ? [failure] : []), ...(use ? [use.charAt(0).toLowerCase() + use.slice(1)] : [])].join(', ');
}

/** Why a failure shows no error text: another signature version, or beyond the extracts kept. Null when it has one, or no failure. */
export function failureGap(cell: Pick<HistoryCell, 'failure'>): string | null {
  const { failure } = cell;
  if (failure === null) return null;
  if (!failure.compared) return "Error not compared: this run was recorded with another version of Loupe's error signatures.";
  if (failure.extract === null) return 'Error text not kept: the report keeps the text of the 300 most recently seen errors.';
  return null;
}

/**
 * "Failed 5 of the last 20 runs · changed status 9 times · passed on retry 3
 * times". The retry counter only when the stream had retries (`retries`):
 * without them, "passed on retry 0 times" says nothing, and the no-retries
 * line says why.
 */
export function countersText(counters: Counters, retries: boolean): string {
  const times = (count: number) => (count === 1 ? 'once' : `${count} times`);
  const parts = [`Failed ${counters.failures} of the last ${plural(counters.considered, 'run')}`, `changed status ${times(counters.statusChanges)}`];
  if (retries) parts.push(`passed on retry ${times(counters.passedOnRetry)}`);
  return parts.join(' · ');
}

/** Which runs each level uses, as `history.include` sets it: the "Which runs are used" paragraph of HistoryHelp. */
export const WHICH_RUNS_TEXT: Record<'full' | 'all', string> = {
  full: "Run comparisons (the change since the previous run) use full runs outside the IDE that are not excluded. A test's history (its state, counters and strip) uses every run where it ran, except excluded ones.",
  all: "Run comparisons (the change since the previous run) use every run, partial, excluded and IDE runs included, because history.include is 'all'. A test's history (its state, counters and strip) uses every run where it ran, excluded ones included.",
};

/** The state of a test in its detail, after its name, with its N for a new failure: "no failure in its last 7 runs in this stream". */
export function stateDetail(state: HistoryState, earlier: number): string {
  switch (state) {
    case 'new-failure':
      return `no failure in its last ${plural(earlier, 'run')} in this stream`;
    case 'failed-again':
      return 'its last earlier result passed, and an earlier one failed';
    case 'still-failing':
      return 'it failed in its last earlier result too';
    case 'new-test':
      return 'no earlier result in this stream, which has earlier runs';
    case 'fixed':
      return 'its last earlier result failed';
  }
}

/** Shown when no run of the window, nor the current run, had retries for the test's project. */
export const NO_RETRIES_TEXT = 'No retries in this stream: only instability across runs can show.';

/** Why another stream may show "no result", reachable as visible text. */
export const NO_RESULT_NOTE =
  "No result: the test is not in that stream's latest run (it was filtered out, or added since). Only the latest run of each other stream is in this report.";
