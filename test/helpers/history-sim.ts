import { readFileSync } from 'node:fs';
import path from 'node:path';
import { extract } from '../../src/core/history/runFile.js';
import type { HistoryRunFile, HistoryTest } from '../../src/schema/history-v1.js';
import type { LoupeReport, TestCase } from '../../src/schema/v1.js';
import { ROOT } from './fixtures.js';
import { makeRunFile } from './history.js';

/**
 * Deterministic pseudo-random numbers in [0, 1): a linear congruential generator modulo 2^31 with a full period,
 * 2^31 draws before it repeats. `Math.imul` keeps the product exact; a plain multiplication passes 2^53 and loses
 * its low bits, which repeated the sequence after about 10,500 draws, fewer than one 5,000-test run takes.
 */
export function random(seed = 42): () => number {
  let state = seed;
  return () => (state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff) / 0x80000000;
}

/** An extract as the run file writes it: flagged `xc` when it is shorter than the message. */
const extractOf = (message: string): { x: string; xc?: true } => {
  const x = extract(message);
  return x === message ? { x } : { x, xc: true };
};

const hex = (rnd: () => number, length: number) => Array.from({ length }, () => '0123456789abcdef'[Math.floor(rnd() * 16)]).join('');

const sample = (): LoupeReport => JSON.parse(readFileSync(path.join(ROOT, 'src/renderer/dev/sample.json'), 'utf8')) as LoupeReport;

/** The `sample` dataset of `npm run perf:sample` (scripts/perf-sample.mjs): the fixture sample repeated to 5,000 tests, 56% failing. */
export function perfSampleReport(count = 5000): LoupeReport {
  const base = sample();
  const tests = Array.from({ length: count }, (_, index) => {
    const test = base.tests[index % base.tests.length] as TestCase;
    return { ...test, id: index.toString(16).padStart(16, '0'), title: `${test.title} #${index}` };
  });
  return { ...base, tests };
}

/** A realistic large suite, as brief 23 modelled it: 2% failed, 1% flaky, 3% skipped, the rest passed. */
export function realisticReport(count = 5000, rnd = random(7)): LoupeReport {
  const base = sample();
  const pools = {
    failed: base.tests.filter((test) => test.outcome === 'failed'),
    flaky: base.tests.filter((test) => test.outcome === 'flaky'),
    skipped: base.tests.filter((test) => test.outcome === 'skipped'),
    passed: base.tests.filter((test) => test.outcome === 'passed'),
  };
  const tests = Array.from({ length: count }, (_, index) => {
    const x = rnd();
    const pool = x < 0.02 ? pools.failed : x < 0.03 ? pools.flaky : x < 0.06 ? pools.skipped : pools.passed;
    const test = pool[index % pool.length] as TestCase;
    return { ...test, id: hex(rnd, 16), title: `${test.title} #${index}` };
  });
  return { ...base, tests };
}

/**
 * `runs` past run files of the report's tests, newest first, in one stream
 * (brief 23's model): a test failing now failed in 60% of past runs, 70% of
 * those with its own signature; a flaky test was flaky in 30%; a passing test
 * failed 2%, was flaky 1% and had no result 1%. Other failures get a new
 * signature and a new extract, so almost every failure has its own: a worst
 * case for the dictionary, kept as an input for the budget tests (brief 26,
 * H3). Realistic windows come from `calibratedWindow`.
 */
export function simulateWindow(report: LoupeReport, runs = 20, stream: HistoryRunFile['run']['stream'] = { environment: 'default', origin: 'local' }, rnd = random(42)): HistoryRunFile[] {
  const messages = report.tests.flatMap((test) => test.attempts.flatMap((attempt) => attempt.errors.map((error) => ({ message: error.message, category: error.category }))));
  const day = 24 * 60 * 60 * 1000;
  const start = Date.parse('2026-11-01T00:00:00.000Z');
  return Array.from({ length: runs }, (_, k) => {
    const tests: HistoryTest[] = [];
    for (const test of report.tests) {
      const x = rnd();
      let code: HistoryTest['o'] | null;
      if (test.outcome === 'skipped') code = 'S';
      else if (test.outcome === 'failed') code = x < 0.6 ? 'F' : 'P';
      else if (test.outcome === 'flaky') code = x < 0.3 ? 'K' : 'P';
      else code = x < 0.02 ? 'F' : x < 0.03 ? 'K' : x < 0.04 ? null : 'P';
      if (code === null) continue;
      const row: HistoryTest = { id: test.id, t: [test.project, test.file, ...test.suitePath, test.title], o: code, d: test.durationMs };
      if (test.repeatEachIndex !== 0) row.r = test.repeatEachIndex;
      if (code === 'F' || code === 'K') {
        row.a = code === 'F' ? 'FF' : 'FP';
        const own = test.errorSignature !== null && rnd() < 0.7;
        const picked = messages[Math.floor(rnd() * messages.length)] ?? { message: 'Error: failed', category: null };
        const ownError = test.attempts.flatMap((attempt) => attempt.errors)[0];
        row.f = [
          {
            i: 0,
            sig: [own ? (test.errorSignature as string) : hex(rnd, 12)],
            cat: own ? (ownError?.category ?? null) : picked.category,
            ...extractOf(own ? (ownError?.message ?? picked.message) : `${picked.message} ${hex(rnd, 10)}`),
            at: null,
          },
        ];
      }
      tests.push(row);
    }
    return makeRunFile({ id: runId(rnd, k), startedAt: new Date(start - k * day).toISOString(), stream }, tests);
  });
}

/** Runs a window can hold: the run index fills the last three hex digits of its id. */
export const MAX_SIMULATED_RUNS = 0x1000;

/**
 * A local run id (a UUID, the longest common form) unique within its window by construction: random digits, then
 * the run index in the last three. `random` repeats itself after some ten thousand draws, so random digits alone
 * gave two runs of one window the same id. The draws are those of a fully random id, so the rest of the window is
 * unchanged.
 */
function runId(rnd: () => number, run: number): string {
  if (run >= MAX_SIMULATED_RUNS) throw new Error(`simulateWindow: at most ${MAX_SIMULATED_RUNS} runs`);
  const random = `${hex(rnd, 8)}-${hex(rnd, 4)}-4${hex(rnd, 3)}-8${hex(rnd, 3)}-${hex(rnd, 12)}`;
  return random.slice(0, -3) + run.toString(16).padStart(3, '0');
}

/** How failures arise in a calibrated window (`calibratedWindow`). */
export interface FailureModel {
  /** Tests broken from some past run up to now, with one signature; 20% of them change it once. */
  broken: number;
  /** Flaky tests, each with its own one or two signatures. */
  flaky: number;
  /** Chance a flaky test fails a run; 70% of those failures pass on retry. */
  flakyRate: number;
  /** Chance a run has incidents (cascades): blocks of neighbouring tests failing with one signature each. */
  incidentRate: number;
  /** Incidents in such a run, and tests in each incident. */
  incidents: [min: number, max: number];
  incidentSize: [min: number, max: number];
  /** Chance an incident recurs, same tests and signature, in the next run. */
  recur: number;
  /** One-off failures per run, each with its own signature. */
  oneOffs: number;
}

/**
 * The calibrated failure models, in one place. Their shape comes from the only real history this was measured on,
 * the two incident days of a 168-test dogfooding suite (21 and 22 October 2026): 67 and 138 failing tests under 17
 * and 12 signatures, the largest shared by 25 and 75 tests, 13 signatures in both runs, 61 tests failing in both.
 * So few signatures, each shared by many tests (cascades), and failures that recur. Their volumes (how many broken
 * and flaky tests, how often incidents happen) are judgement, until real history data exists to check them.
 */
export const FAILURE_MODELS = {
  /** An ordinary window: a few broken and flaky tests, an incident in one run of ten. About 28 failing per run. */
  normal: { broken: 25, flaky: 75, flakyRate: 0.15, incidentRate: 0.1, incidents: [1, 1], incidentSize: [20, 200], recur: 0.5, oneOffs: 3 },
  /** Every run an incident day like the two real ones: 10 to 20 cascades of 100 to 400 tests, a third recurring. */
  incidentDays: { broken: 25, flaky: 75, flakyRate: 0.15, incidentRate: 1, incidents: [10, 20], incidentSize: [100, 400], recur: 0.33, oneOffs: 3 },
} as const satisfies Record<string, FailureModel>;

/**
 * `runs` past run files of the report's tests, newest first, in one stream, failing as `model` says. The report's
 * failed tests give the broken ones and its flaky tests the first flaky ones; every other test passes (or stays
 * skipped). Each signature has its own extract: an error message of the report with a random suffix.
 */
export function calibratedWindow(report: LoupeReport, model: FailureModel, runs = 20, stream: HistoryRunFile['run']['stream'] = { environment: 'default', origin: 'local' }, rnd = random(42)): HistoryRunFile[] {
  const count = report.tests.length;
  const messages = report.tests.flatMap((test) => test.attempts.flatMap((attempt) => attempt.errors.map((error) => ({ message: error.message, category: error.category }))));
  const newSignature = () => ({ sig: hex(rnd, 12), ...(messages[Math.floor(rnd() * messages.length)] ?? { message: 'Error: failed', category: null }), suffix: hex(rnd, 10) });
  type Signature = ReturnType<typeof newSignature>;
  const between = ([min, max]: readonly [number, number]) => min + Math.floor(rnd() * (max - min + 1));
  const indexes = (outcome: TestCase['outcome']) => report.tests.flatMap((test, index) => (test.outcome === outcome ? [index] : []));
  // Run 0 is the newest: a broken test fails from run `from` (its start) to run 0.
  const broken = indexes('failed')
    .slice(0, model.broken)
    .map((index) => ({ index, sig: newSignature(), from: Math.floor(rnd() * runs), changed: rnd() < 0.2 ? newSignature() : null }));
  const flakyNow = indexes('flaky');
  const flaky = [...flakyNow, ...Array.from({ length: Math.max(0, model.flaky - flakyNow.length) }, () => Math.floor(rnd() * count))]
    .slice(0, model.flaky)
    .map((index) => ({ index, sigs: [newSignature(), ...(rnd() < 0.5 ? [newSignature()] : [])] }));
  const day = 24 * 60 * 60 * 1000;
  const start = Date.parse('2026-11-01T00:00:00.000Z');
  let previous: Array<{ first: number; size: number; sig: Signature }> = [];
  const files: HistoryRunFile[] = [];
  // Oldest first, so an incident can recur in the next run; returned newest first.
  for (let k = runs - 1; k >= 0; k--) {
    const failing = new Map<number, { o: 'F' | 'K'; sig: Signature }>();
    let incidents: typeof previous = [];
    if (rnd() < model.incidentRate) {
      const wanted = between(model.incidents);
      incidents = previous.filter(() => rnd() < model.recur);
      while (incidents.length < wanted) incidents.push({ first: Math.floor(rnd() * count), size: between(model.incidentSize), sig: newSignature() });
      for (const incident of incidents) for (let j = 0; j < incident.size; j++) failing.set((incident.first + j) % count, { o: 'F', sig: incident.sig });
    }
    previous = incidents;
    for (const test of broken) if (k <= test.from) failing.set(test.index, { o: 'F', sig: test.changed !== null && k < test.from / 2 ? test.changed : test.sig });
    for (const test of flaky) if (rnd() < model.flakyRate) failing.set(test.index, { o: rnd() < 0.7 ? 'K' : 'F', sig: test.sigs[Math.floor(rnd() * test.sigs.length)] as Signature });
    for (let j = 0; j < model.oneOffs; j++) failing.set(Math.floor(rnd() * count), { o: 'F', sig: newSignature() });
    const tests = report.tests.map((test, index): HistoryTest => {
      const row: HistoryTest = { id: test.id, t: [test.project, test.file, ...test.suitePath, test.title], o: test.outcome === 'skipped' ? 'S' : 'P', d: test.durationMs };
      if (test.repeatEachIndex !== 0) row.r = test.repeatEachIndex;
      const failure = failing.get(index);
      if (failure !== undefined && row.o !== 'S') {
        row.o = failure.o;
        row.a = failure.o === 'F' ? 'FF' : 'FP';
        row.f = [{ i: 0, sig: [failure.sig.sig], cat: failure.sig.category, ...extractOf(`${failure.sig.message} ${failure.sig.suffix}`), at: null }];
      }
      return row;
    });
    files.push(makeRunFile({ id: runId(rnd, k), startedAt: new Date(start - k * day).toISOString(), stream }, tests));
  }
  return files.reverse();
}

/** A simulated window: `runs` past run files of the report's tests in `stream`, newest first, drawn from `rnd`. */
export type SimulatedWindow = (report: LoupeReport, runs?: number, stream?: HistoryRunFile['run']['stream'], rnd?: () => number) => HistoryRunFile[];

/**
 * The named windows: the calibrated models, an ordinary window and one of incident days, and brief 23's model, where
 * almost every failure has a signature of its own (a worst case for the dictionary, kept for the budget tests).
 */
export const WINDOWS = {
  normal: calibrated(FAILURE_MODELS.normal),
  incidentDays: calibrated(FAILURE_MODELS.incidentDays),
  brief23: simulateWindow,
} as const satisfies Record<string, SimulatedWindow>;

function calibrated(model: FailureModel): SimulatedWindow {
  return (report, runs, stream, rnd) => calibratedWindow(report, model, runs, stream, rnd);
}
