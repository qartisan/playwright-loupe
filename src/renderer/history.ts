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

/** The stream, as its key parts: `default · local`, `staging · ci · main`. */
export function streamName(stream: HistoryRun['stream']): string {
  return Object.values(stream)
    .map((part) => part ?? 'no branch')
    .join(' · ');
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
 * Why a cell is drawn apart, in words: the run is excluded (it does not
 * count), or it counts but is partial or from the IDE. Empty for a full run
 * that counts.
 */
export function cellCounting(cell: Pick<HistoryCell, 'run' | 'runCounts' | 'flags'>): string[] {
  const notes: string[] = [];
  if (!cell.runCounts) notes.push(`not counted: run excluded${cell.run.excluded ? ` (${cell.run.excluded})` : ''}`);
  else if (cell.flags.includes('excluded')) notes.push(`excluded run${cell.run.excluded ? ` (${cell.run.excluded})` : ''}, counted with history.include: 'all'`);
  if (cell.flags.includes('partial')) notes.push(`partial run${cell.run.scopeReasons.length > 0 ? ` (${cell.run.scopeReasons.join(', ')})` : ''}`);
  if (cell.flags.includes('ide')) notes.push('run from the IDE');
  return notes;
}

/**
 * The full accessible name of a strip cell: "21 Oct 2026, 18:45, ci,
 * failed, Timeout", then why it is drawn apart. `date` is the run's start as
 * the report formats it.
 */
export function cellName(cell: Pick<HistoryCell, 'run' | 'code' | 'attempts' | 'failure' | 'runCounts' | 'flags'>, date: string): string {
  const failure = cell.code === 'F' || cell.code === 'K' ? failureWord(cell) : null;
  return [date, cell.run.origin, RESULT_TEXT[cell.code], ...(failure ? [failure] : []), ...cellCounting(cell)].join(', ');
}

/** Why a failure shows no error text: another signature version, or beyond the extracts kept. Null when it has one, or no failure. */
export function failureGap(cell: Pick<HistoryCell, 'failure'>): string | null {
  const { failure } = cell;
  if (failure === null) return null;
  if (!failure.compared) return "Error not compared: this run was recorded with another version of Loupe's error signatures.";
  if (failure.extract === null) return 'Error text not kept: the report keeps the text of the 300 most recently seen errors.';
  return null;
}

/** "Failed 5 of the last 20 runs · changed status 9 times · passed on retry 3 times". */
export function countersText(counters: Counters): string {
  const times = (count: number) => (count === 1 ? 'once' : `${count} times`);
  return `Failed ${counters.failures} of the last ${plural(counters.considered, 'run')} · changed status ${times(counters.statusChanges)} · passed on retry ${times(counters.passedOnRetry)}`;
}

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
