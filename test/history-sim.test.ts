import { describe, expect, it } from 'vitest';
import { MAX_SIMULATED_RUNS, perfSampleReport, random, realisticReport, simulateWindow } from './helpers/history-sim.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/;
const ids = (runs: ReturnType<typeof simulateWindow>) => runs.map((file) => file.run.id);

// Notes and exclusions apply by run id: a repeated id would give one notes entry to two runs, and the size guard
// would measure another window than it says.
describe('the history simulator', () => {
  it('never repeats a run id within the windows of the size guard', () => {
    for (const report of [realisticReport(), perfSampleReport()]) {
      const window = ids(simulateWindow(report, 20));
      expect(new Set(window).size).toBe(20);
      for (const id of window) expect(id).toMatch(UUID);
    }
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
