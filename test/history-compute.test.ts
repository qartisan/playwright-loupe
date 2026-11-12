import { describe, expect, it } from 'vitest';
import { deriveEmbedded } from '../src/core/history/embed.js';
import type { EmbeddedHistory, HistoryRun, HistoryTest } from '../src/schema/history-v1.js';
import type { LoupeReport, Outcome } from '../src/schema/v1.js';
import {
  HISTORY_STATES,
  analyzeHistory,
  countResults,
  decodeHistory,
  indexHistory,
  otherStreams,
  stateOf,
  testCells,
  type CurrentReport,
  type ResultCode,
} from '../src/shared/history.js';
import { makeRunFile } from './helpers/history.js';

const STREAM = { environment: 'default', origin: 'local' };

/** A past run: one code per test of the report (`-` for no result), oldest run first in `history()`. */
interface PastRun {
  codes: string;
  run?: Partial<HistoryRun>;
  signatureVersion?: number;
}

function row(id: string, code: string, column: number): HistoryTest | null {
  if (code === '-') return null;
  const base: HistoryTest = { id, t: ['p', 'a.spec.ts', id], o: code as HistoryTest['o'], d: 1 };
  if (code === 'F') return { ...base, a: 'FT', f: [{ i: 0, sig: [`sig-${id}-${column}`], cat: 'Assertion', x: `extract ${id} ${column}`, at: null }] };
  if (code === 'K') return { ...base, a: 'FP', f: [{ i: 0, sig: [`sig-${id}-${column}`], cat: 'Timeout', x: `extract ${id} ${column}`, at: null }] };
  return base;
}

const day = (column: number) => new Date(Date.UTC(2026, 10, 1 + column, 10)).toISOString();

interface Setup {
  /** The current outcome of each test; the test ids are t0, t1, … */
  outcomes: Outcome[];
  past: PastRun[];
  current?: { scope?: 'full' | 'partial'; excluded?: string | null; origin?: HistoryRun['origin']; retries?: number; stats?: Partial<LoupeReport['run']['stats']> };
  include?: EmbeddedHistory['include'];
  skipped?: number;
}

/** The block the core would embed for these runs, and the report it goes with. */
function history({ outcomes, past, current = {}, include = 'full', skipped = 0 }: Setup): { block: EmbeddedHistory; report: CurrentReport } {
  const ids = outcomes.map((_, index) => `t${index}`);
  const files = past.map(({ codes, run = {}, signatureVersion }, column) => {
    const tests = ids.map((id, index) => row(id, codes[index] ?? '-', column)).filter((test): test is HistoryTest => test !== null);
    const file = makeRunFile({ id: `r${column}`, startedAt: day(column), stream: STREAM, ...run }, tests);
    return signatureVersion === undefined ? file : { ...file, signatureVersion };
  });
  const stats = { total: outcomes.length, passed: 0, failed: 0, flaky: 0, skipped: 0, ...current.stats };
  const report = {
    run: { scope: current.scope ?? 'full', startedAt: '2026-11-30T10:00:00.000Z', stats },
    projects: [{ name: 'p', retries: current.retries ?? 0 }],
    tests: outcomes.map((outcome, index) => ({ id: ids[index], repeatEachIndex: 0, outcome, project: 'p' })),
  };
  const block = deriveEmbedded(report as unknown as LoupeReport, { runs: [...files].reverse(), others: [], skipped }, {
    include,
    stream: STREAM,
    current: { origin: current.origin ?? 'local', excluded: current.excluded ?? null },
    currentRunId: 'current',
  });
  if (block === null) throw new Error('no block');
  return { block, report };
}

const analyze = (setup: Setup) => {
  const { block, report } = history(setup);
  return analyzeHistory(block, report);
};
const stateFor = (outcome: Outcome, ...codes: string[]) => analyze({ outcomes: [outcome], past: codes.map((code) => ({ codes: code })) }).tests[0]?.state;

describe('failure states of a failing test (decision 2)', () => {
  it('New test: no comparable result in the window (absent, skipped)', () => {
    expect(stateFor('failed', '-', 'S', '-')).toBe('new-test');
  });

  it('New failure: comparable results, none with a failed attempt; N is the number of those results', () => {
    const analysis = analyze({ outcomes: ['failed'], past: [{ codes: 'P' }, { codes: '-' }, { codes: 'P' }, { codes: 'S' }, { codes: 'P' }] });
    expect(analysis.tests[0]).toMatchObject({ state: 'new-failure', earlier: 3 });
  });

  it('Still failing: the most recent comparable result is a failure, skipped and absent results after it ignored', () => {
    expect(stateFor('failed', 'P', 'F')).toBe('still-failing');
    expect(stateFor('failed', 'P', 'F', 'S', '-')).toBe('still-failing');
  });

  it('Failed again: the most recent comparable result passed, or was flaky, and the window holds a failed attempt', () => {
    expect(stateFor('failed', 'F', 'P')).toBe('failed-again');
    expect(stateFor('failed', 'F', 'K')).toBe('failed-again');
  });

  it('a past flaky result counts as a failed attempt: never New failure', () => {
    expect(stateFor('failed', 'P', 'K', 'P')).toBe('failed-again');
    expect(stateFor('failed', 'K')).toBe('failed-again');
  });

  it('exactly one state for every failing test', () => {
    for (const codes of ['', 'P', 'F', 'K', 'S', '-', 'PF', 'FP', 'KP', 'PK', 'FK', 'KF', 'SF', 'F-', 'PPP', 'FFF']) {
      expect(HISTORY_STATES.filter((state) => state !== 'fixed')).toContain(stateOf('failed', [...codes] as ResultCode[]));
    }
  });
});

describe('Fixed', () => {
  it('the current run passes or is flaky, and the most recent comparable result was a failure', () => {
    expect(stateFor('passed', 'P', 'F')).toBe('fixed');
    expect(stateFor('flaky', 'F', 'S')).toBe('fixed');
  });

  it('not after a pass or a flaky result, not for a skipped test', () => {
    expect(stateFor('passed', 'F', 'P')).toBeNull();
    expect(stateFor('passed', 'F', 'K')).toBeNull();
    expect(stateFor('skipped', 'F')).toBeNull();
    expect(stateOf('passed', [])).toBeNull();
  });
});

describe('counters (decision 3)', () => {
  const codes = (text: string) => [...text] as ResultCode[];

  it('broken five runs ago: failed 5 times, changed status once', () => {
    expect(countResults(codes(`${'P'.repeat(15)}${'F'.repeat(5)}`))).toEqual({ failures: 5, statusChanges: 1, passedOnRetry: 0, considered: 20 });
  });

  it('alternating: the same 5 failures, 9 status changes', () => {
    expect(countResults(codes(`FPFPFPFPF${'P'.repeat(11)}`))).toEqual({ failures: 5, statusChanges: 9, passedOnRetry: 0, considered: 20 });
  });

  it('flaky counts as a pass for status changes, and as a pass on retry', () => {
    expect(countResults(codes('PKP'))).toEqual({ failures: 0, statusChanges: 0, passedOnRetry: 1, considered: 3 });
    expect(countResults(codes('FKF'))).toEqual({ failures: 2, statusChanges: 2, passedOnRetry: 1, considered: 3 });
  });

  it('skipped and absent results are not counted and do not break a sequence', () => {
    expect(countResults(codes('F-SF'))).toEqual({ failures: 2, statusChanges: 0, passedOnRetry: 0, considered: 2 });
  });

  it('over the window plus the current run', () => {
    const analysis = analyze({ outcomes: ['failed'], past: [{ codes: 'P' }, { codes: 'K' }, { codes: 'F' }] });
    expect(analysis.tests[0]?.counters).toEqual({ failures: 2, statusChanges: 1, passedOnRetry: 1, considered: 4 });
  });
});

describe('test level: every result where the test ran, in a run not excluded', () => {
  it('an excluded run is ignored', () => {
    const analysis = analyze({ outcomes: ['failed'], past: [{ codes: 'P' }, { codes: 'F', run: { excluded: { reason: 'staging restored' } } }] });
    expect(analysis.tests[0]).toMatchObject({ state: 'new-failure', earlier: 1, counters: { considered: 2, failures: 1 } });
  });

  it('partial and ide runs count', () => {
    expect(analyze({ outcomes: ['failed'], past: [{ codes: 'P' }, { codes: 'F', run: { scope: 'partial', scopeReasons: ['project'] } }] }).tests[0]?.state).toBe('still-failing');
    expect(analyze({ outcomes: ['failed'], past: [{ codes: 'P' }, { codes: 'F', run: { origin: 'ide' } }] }).tests[0]?.state).toBe('still-failing');
  });

  it("include: 'all' brings excluded runs back", () => {
    const past = [{ codes: 'P' }, { codes: 'F', run: { excluded: { reason: 'x' } } }];
    expect(analyze({ outcomes: ['failed'], past, include: 'all' }).tests[0]?.state).toBe('still-failing');
  });

  it('an excluded current run is left out of the counters; its state is still computed', () => {
    const analysis = analyze({ outcomes: ['failed'], past: [{ codes: 'F' }], current: { excluded: 'restore' } });
    expect(analysis.tests[0]).toMatchObject({ state: 'still-failing', counters: { considered: 1 } });
  });

  it('a stream of partial runs only, and an ide stream, show test states', () => {
    const partial = analyze({ outcomes: ['failed', 'failed'], past: [{ codes: 'P-', run: { scope: 'partial', scopeReasons: ['project'] } }, { codes: 'FP', run: { scope: 'partial', scopeReasons: ['project'] } }], current: { scope: 'partial' } });
    expect([partial.statesShown, partial.noStates, partial.tests.map((test) => test.state)]).toEqual([true, null, ['still-failing', 'new-failure']]);
    const ide = analyze({ outcomes: ['failed'], past: [{ codes: 'F', run: { origin: 'ide' } }], current: { origin: 'ide' } });
    expect([ide.statesShown, ide.tests[0]?.state, ide.counts['still-failing']]).toEqual([true, 'still-failing', 1]);
  });

  it('every earlier run excluded: no state at all, counts at zero', () => {
    const analysis = analyze({ outcomes: ['failed', 'passed'], past: [{ codes: 'FF', run: { excluded: { reason: 'a' } } }, { codes: 'PF', run: { excluded: { reason: 'b' } } }] });
    expect([analysis.statesShown, analysis.noStates]).toEqual([false, 'all-excluded']);
    expect(analysis.tests.map((test) => test.state)).toEqual([null, null]);
    expect(Object.values(analysis.counts)).toEqual([0, 0, 0, 0, 0]);
  });

  it('counts each state', () => {
    const analysis = analyze({ outcomes: ['failed', 'failed', 'failed', 'failed', 'passed', 'passed'], past: [{ codes: 'PFP-FP' }, { codes: 'PFFS-P' }] });
    expect(analysis.tests.map((test) => test.state)).toEqual(['new-failure', 'still-failing', 'still-failing', 'new-test', 'fixed', null]);
    expect(analysis.counts).toEqual({ 'new-failure': 1, 'failed-again': 0, 'still-failing': 2, 'new-test': 1, fixed: 1 });
  });
});

describe('run level: the verdict delta', () => {
  const stats = (passed: number, failed: number, skipped = 0) => ({ total: passed + failed + skipped, passed, failed, flaky: 0, skipped });

  it('against the previous run counting at run level: pass rate points and failed tests', () => {
    const analysis = analyze({
      outcomes: ['passed'],
      past: [{ codes: 'P', run: { id: 'full', stats: stats(8, 2) } }, { codes: 'P', run: { scope: 'partial', stats: stats(1, 0) } }, { codes: 'P', run: { origin: 'ide', stats: stats(1, 0) } }, { codes: 'P', run: { excluded: { reason: 'x' }, stats: stats(1, 0) } }],
      current: { stats: stats(9, 1) },
    });
    expect(analysis.noDelta).toBeNull();
    expect(analysis.delta?.previous.id).toBe('full');
    expect(analysis.delta?.passRatePoints).toBeCloseTo(10);
    expect(analysis.delta?.failed).toBe(-1);
  });

  it("include: 'all' compares with the previous run whatever it is", () => {
    const analysis = analyze({ outcomes: ['passed'], past: [{ codes: 'P', run: { id: 'full' } }, { codes: 'P', run: { id: 'ide', origin: 'ide' } }], include: 'all', current: { scope: 'partial' } });
    expect([analysis.noDelta, analysis.delta?.previous.id]).toEqual([null, 'ide']);
  });

  it('no delta when the current run does not count, with the reason; states are still computed', () => {
    const past = [{ codes: 'F' }];
    expect(analyze({ outcomes: ['failed'], past, current: { scope: 'partial' } })).toMatchObject({ delta: null, noDelta: 'current-partial', counts: { 'still-failing': 1 } });
    expect(analyze({ outcomes: ['failed'], past, current: { origin: 'ide' } })).toMatchObject({ delta: null, noDelta: 'current-ide' });
    expect(analyze({ outcomes: ['failed'], past, current: { excluded: 'x', origin: 'ide', scope: 'partial' } })).toMatchObject({ delta: null, noDelta: 'current-excluded' });
  });

  it('no delta when no earlier run counts at run level; states are still shown', () => {
    const analysis = analyze({ outcomes: ['failed'], past: [{ codes: 'F', run: { scope: 'partial' } }, { codes: 'F', run: { origin: 'ide' } }] });
    expect(analysis).toMatchObject({ delta: null, noDelta: 'no-earlier-run', statesShown: true, counts: { 'still-failing': 1 } });
  });

  it('no pass rate change when a run has no test that ran', () => {
    const analysis = analyze({ outcomes: ['skipped'], past: [{ codes: 'S', run: { stats: stats(0, 0, 1) } }], current: { stats: stats(0, 0, 1) } });
    expect(analysis.delta).toMatchObject({ passRatePoints: null, failed: 0 });
  });
});

describe('no retries (Step 0 decision 6)', () => {
  const projects = (retries: number) => ({ projects: [{ name: 'p', retries }, { name: 'other', retries: 3 }] });

  it("when every run of the window and the current run had 0 retries for the test's project", () => {
    expect(analyze({ outcomes: ['passed'], past: [{ codes: 'P', run: projects(0) }, { codes: 'P', run: { projects: [] } }] }).tests[0]?.noRetries).toBe(true);
  });

  it('not when one run of the window, or the current run, had retries', () => {
    expect(analyze({ outcomes: ['passed'], past: [{ codes: 'P', run: projects(2) }, { codes: 'P', run: projects(0) }] }).tests[0]?.noRetries).toBe(false);
    expect(analyze({ outcomes: ['passed'], past: [{ codes: 'P', run: projects(0) }], current: { retries: 1 } }).tests[0]?.noRetries).toBe(false);
  });
});

describe('notices', () => {
  it('a signature version break: errors before the first run after it are not compared', () => {
    const analysis = analyze({ outcomes: ['failed'], past: [{ codes: 'F', signatureVersion: 5 }, { codes: 'F', signatureVersion: 5 }, { codes: 'P' }] });
    expect(analysis.signatureBreak).toEqual({ before: day(2) });
    // Statuses still count.
    expect(analysis.tests[0]?.state).toBe('failed-again');
  });

  it('the newest runs of another version: before the current run', () => {
    expect(analyze({ outcomes: ['failed'], past: [{ codes: 'F', signatureVersion: 5 }] }).signatureBreak).toEqual({ before: '2026-11-30T10:00:00.000Z' });
    expect(analyze({ outcomes: ['failed'], past: [{ codes: 'F' }] }).signatureBreak).toBeNull();
  });

  it('every file of the window skipped: no test state (their past is unreadable, not empty), the reason at run level', () => {
    const analysis = analyze({ outcomes: ['failed', 'passed'], past: [], skipped: 2 });
    expect([analysis.skipped, analysis.statesShown, analysis.noStates, analysis.noDelta]).toEqual([2, false, 'all-skipped', 'no-earlier-run']);
    expect(analysis.tests.map((test) => test.state)).toEqual([null, null]);
    expect(Object.values(analysis.counts)).toEqual([0, 0, 0, 0, 0]);
  });

  it('a window shortened by skipped files: states shown from the runs left, with the skipped count', () => {
    const analysis = analyze({ outcomes: ['failed'], past: [{ codes: 'F' }], skipped: 2 });
    expect([analysis.skipped, analysis.statesShown, analysis.noStates, analysis.tests[0]?.state]).toEqual([2, true, null, 'still-failing']);
  });

  it('first run of a stream (no earlier run, nothing skipped, other streams known): no test state, not every failing test "New test"', () => {
    const { block, report } = history({ outcomes: ['failed', 'passed'], past: [{ codes: 'FF' }] });
    const other = { stream: { environment: 'staging', origin: 'ci' }, id: 'o1', startedAt: day(3), cells: 'FP' };
    const analysis = analyzeHistory({ ...block, runs: [], cells: '', others: [other] }, report);
    expect([analysis.statesShown, analysis.noStates, analysis.noDelta]).toEqual([false, 'first-run', 'no-earlier-run']);
    expect(analysis.tests.map((test) => test.state)).toEqual([null, null]);
    expect(Object.values(analysis.counts)).toEqual([0, 0, 0, 0, 0]);
  });

  it('"New test" stays for a test without results in a stream that has earlier runs', () => {
    const analysis = analyze({ outcomes: ['failed', 'failed'], past: [{ codes: 'P-' }] });
    expect([analysis.statesShown, analysis.noStates, analysis.tests.map((test) => test.state)]).toEqual([true, null, ['new-failure', 'new-test']]);
  });
});

describe('decodeHistory', () => {
  const { block } = history({ outcomes: ['passed', 'failed'], past: [{ codes: 'PF' }] });

  it('a block of this version that fits the report', () => {
    expect(decodeHistory(JSON.parse(JSON.stringify(block)), 2)).toEqual(block);
  });

  it.each([
    ['null', null],
    ['a string', 'x'],
    ['an array', []],
    ['another version', { ...block, v: 2 }],
    ['no current run facts', { ...block, current: undefined }],
    ['no skipped count', { ...block, skipped: undefined }],
    ['an unknown include', { ...block, include: 'some' }],
    ['cells for another number of tests', { ...block, cells: 'P' }],
    ['another stream with cells for another number of tests', { ...block, others: [{ stream: {}, id: 'o', startedAt: day(0), cells: 'P' }] }],
  ])('%s: no history', (_label, value) => {
    expect(decodeHistory(value, 2)).toBeNull();
  });
});

describe('the strip of a test', () => {
  it('one cell per run, oldest first, with its attempts, flags, whether it counts, and the error of a failure', () => {
    const { block } = history({
      outcomes: ['failed', 'passed'],
      past: [
        { codes: 'FP', signatureVersion: 5 },
        { codes: 'KP', run: { scope: 'partial', scopeReasons: ['grep'] } },
        { codes: 'F-', run: { excluded: { reason: 'restore' } } },
        { codes: 'SS', run: { origin: 'ide' } },
      ],
    });
    const index = indexHistory(block);
    const cells = testCells(block, index, 0);
    expect(cells.map(({ index: column, code, attempts, flags, counts, failure }) => ({ column, code, attempts, flags, counts, failure }))).toEqual([
      { column: 0, code: 'F', attempts: 'FT', flags: [], counts: true, failure: { category: null, extract: null, compared: false } },
      { column: 1, code: 'K', attempts: 'FP', flags: ['partial'], counts: true, failure: { category: 'Timeout', extract: 'extract t0 1', compared: true } },
      { column: 2, code: 'F', attempts: 'FT', flags: ['excluded'], counts: false, failure: { category: 'Assertion', extract: 'extract t0 2', compared: true } },
      { column: 3, code: 'S', attempts: 'S', flags: ['ide'], counts: false, failure: null },
    ]);
    expect(cells[1]?.run.scopeReasons).toEqual(['grep']);
    expect(testCells(block, index, 1).map((cell) => [cell.code, cell.attempts])).toEqual([
      ['P', 'P'],
      ['P', 'P'],
      ['-', null],
      ['S', 'S'],
    ]);
  });

  it('the latest result in each other stream, "-" when that run has none', () => {
    const { block, report } = history({ outcomes: ['passed', 'failed'], past: [{ codes: 'PP' }] });
    const other = { stream: { environment: 'staging', origin: 'ci' }, id: 'o1', startedAt: day(3), cells: 'F-' };
    const withOthers = { ...block, others: [other] };
    expect(otherStreams(withOthers, 0)).toEqual([{ stream: other.stream, id: 'o1', startedAt: day(3), code: 'F' }]);
    expect(otherStreams(withOthers, 1)[0]?.code).toBe('-');
    expect(analyzeHistory(withOthers, report).tests).toHaveLength(2);
  });
});
