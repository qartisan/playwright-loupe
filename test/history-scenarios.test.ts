import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LoupeReport } from '../src/schema/v1.js';
import { analyzeHistory, decodeHistory, type HistoryAnalysis } from '../src/shared/history.js';
import { HISTORY_SCENARIOS, historyScenario, type HistoryScenario } from './helpers/history-scenarios.js';

/** The dev server's scenarios (`?history=<name>`) show what their names say. */
const sample = JSON.parse(readFileSync(new URL('../src/renderer/dev/sample.json', import.meta.url), 'utf8')) as LoupeReport;

function analysis(name: HistoryScenario): HistoryAnalysis {
  const { report, history } = historyScenario(name, sample);
  // As the renderer reads it: through JSON, checked against the report.
  const block = decodeHistory(JSON.parse(JSON.stringify(history)), report.tests.length);
  if (block === null) throw new Error(`${name}: no history`);
  return analyzeHistory(block, report);
}

const stateTotal = (result: HistoryAnalysis) => Object.values(result.counts).reduce((sum, count) => sum + count, 0);
const failing = (result: HistoryAnalysis, report: LoupeReport) => result.tests.filter((_, index) => report.tests[index]?.outcome === 'failed');

describe('dev history scenarios', () => {
  it('every scenario but "none" gives a block the renderer accepts; "none" gives null', () => {
    expect(historyScenario('none', sample).history).toBeNull();
    for (const name of HISTORY_SCENARIOS.filter((scenario) => scenario !== 'none')) expect(() => analysis(name), name).not.toThrow();
  });

  it('normal: every state, a delta, flagged runs in the window', () => {
    const result = analysis('normal');
    expect(Object.entries(result.counts).filter(([, count]) => count === 0)).toEqual([]);
    expect(result.delta).not.toBeNull();
    expect(result.history.runs).toHaveLength(20);
    expect(result.history.runs.map((run) => [run.scope, run.excluded !== null, run.origin]).filter(([scope, excluded, origin]) => scope === 'partial' || excluded || origin === 'ide')).toHaveLength(3);
  });

  it('first run after enabling: one earlier run', () => {
    expect(analysis('first-run').history.runs).toHaveLength(1);
  });

  it('broken: one status change for every failing test that ran before; alternating: many', () => {
    const report = historyScenario('broken', sample).report;
    expect(new Set(failing(analysis('broken'), report).map((test) => test.counters.statusChanges))).toEqual(new Set([1]));
    expect(Math.min(...failing(analysis('alternating'), report).map((test) => test.counters.statusChanges))).toBeGreaterThanOrEqual(9);
  });

  it('no-retries: every test has the line; normal: none (the sample has retries)', () => {
    expect(analysis('no-retries').tests.every((test) => test.noRetries)).toBe(true);
    expect(analysis('normal').tests.some((test) => test.noRetries)).toBe(false);
  });

  it('several streams: three others', () => {
    expect(analysis('several-streams').history.others).toHaveLength(3);
  });

  it('version break: errors before a date are not compared', () => {
    expect(analysis('version-break').signatureBreak).toEqual({ before: analysis('version-break').history.runs[8]?.startedAt });
  });

  it('current run partial: no delta, test states', () => {
    const result = analysis('current-partial');
    expect([result.noDelta, result.statesShown, stateTotal(result) > 0]).toEqual(['current-partial', true, true]);
  });

  it('a stream of partial runs only, and an ide stream: test states, no delta', () => {
    const partial = analysis('all-partial');
    expect([partial.noDelta, partial.statesShown, stateTotal(partial) > 0]).toEqual(['current-partial', true, true]);
    const ide = analysis('ide');
    expect([ide.noDelta, ide.statesShown, stateTotal(ide) > 0]).toEqual(['current-ide', true, true]);
  });

  it('skipped: an empty window with 3 skipped files, no test states; all excluded: no test states', () => {
    const skipped = analysis('skipped');
    expect([skipped.history.runs.length, skipped.skipped, skipped.statesShown, skipped.noStates, stateTotal(skipped)]).toEqual([0, 3, false, 'all-skipped', 0]);
    expect([analysis('all-excluded').statesShown, analysis('all-excluded').noStates]).toEqual([false, 'all-excluded']);
  });

  it('skipped-some: a window shortened to 17 runs, test states and the skipped count', () => {
    const result = analysis('skipped-some');
    expect([result.history.runs.length, result.skipped, result.statesShown, stateTotal(result) > 0]).toEqual([17, 3, true, true]);
  });
});
