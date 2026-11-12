import type { HistoryRun } from '../schema/history-v1.js';
import type { LoupeReport, TestCase } from '../schema/v1.js';
import { analyzeHistory, decodeHistory, type HistoryAnalysis, type HistoryState, type NoDeltaReason, type NoStatesReason, type TestHistory } from '../shared/history.js';
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
  return { analysis, byTest: new Map(report.tests.map((test, index) => [test, analysis.tests[index] as TestHistory])) };
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
