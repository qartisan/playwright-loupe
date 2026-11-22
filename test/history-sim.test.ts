import { describe, expect, it } from 'vitest';
import type { HistoryRunFile } from '../src/schema/history-v1.js';
import { MAX_SIMULATED_RUNS, WINDOWS, perfSampleReport, random, realisticReport, simulateWindow } from './helpers/history-sim.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/;
const ids = (runs: ReturnType<typeof simulateWindow>) => runs.map((file) => file.run.id);

// Notes and exclusions apply by run id: a repeated id would give one notes entry to two runs, and the size guard
// would measure another window than it says.
/** Per run, newest first: failing tests and their distinct signatures. */
const failingRuns = (runs: readonly HistoryRunFile[]) =>
  runs.map((file) => {
    const failing = file.tests.filter((test) => test.o === 'F' || test.o === 'K');
    return { failing: failing.length, signatures: new Set(failing.map((test) => test.f?.[0]?.sig[0])).size };
  });
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] as number;

describe('the history simulator', () => {
  // A 5,000-test window of brief 23's model draws about 200,000 numbers; the old generator repeated after 10,500.
  it('draws a million numbers without repeating one, whatever the seed', () => {
    for (const seed of [1, 42, 100]) {
      const rnd = random(seed);
      const seen = new Set<number>();
      for (let draw = 0; draw < 1_000_000; draw++) seen.add(rnd());
      expect(seen.size).toBe(1_000_000);
    }
  });

  it('never repeats a run id within the windows of the size guard', () => {
    for (const report of [realisticReport(), perfSampleReport()]) {
      for (const window of Object.values(WINDOWS)) {
        const runs = ids(window(report, 20));
        expect(new Set(runs).size).toBe(20);
        for (const id of runs) expect(id).toMatch(UUID);
      }
    }
  });

  // The shape the calibrated models were given (FAILURE_MODELS): a change of the simulator that loses it fails here.
  it('keeps the calibrated windows in shape: few failures on an ordinary window, cascades on incident days', () => {
    const report = realisticReport();
    const normal = failingRuns(WINDOWS.normal(report, 20));
    expect(median(normal.map((run) => run.failing))).toBeLessThan(report.tests.length * 0.02);
    const incidents = failingRuns(WINDOWS.incidentDays(report, 20));
    expect(median(incidents.map((run) => run.failing))).toBeGreaterThan(report.tests.length * 0.3);
    // Cascades: on incident days, each signature is shared by tens of tests.
    for (const run of incidents) expect(run.failing / run.signatures).toBeGreaterThan(20);
  });

  it('never repeats a run id in a long window, whatever the seed', () => {
    const report = perfSampleReport(50);
    for (const seed of [1, 42, 100]) {
      const window = ids(simulateWindow(report, 600, undefined, random(seed)));
      expect(new Set(window).size).toBe(600);
    }
  });

  it('refuses a window longer than its ids can number', () => {
    expect(() => simulateWindow(perfSampleReport(1), MAX_SIMULATED_RUNS + 1)).toThrow(/at most 4096 runs/);
  });
});
