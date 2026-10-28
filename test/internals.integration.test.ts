import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LoupeReport } from '../src/schema/v1.js';
import { INTERNALS_CONFIG, assertBuilt, playwright, readReport } from './helpers/fixtures.js';
import { schemaErrors } from './helpers/schema.js';

/**
 * The Playwright internals Loupe reads (`_only`, `default` through
 * `configInternalSymbol`, `metadata.actualWorkers`, the `_mode` and
 * `configDir` reporter options), removed or reshaped in a real run of
 * fixtures/internals.config.ts: the report is still produced, with less
 * precise data at worst.
 */
describe('Playwright internals missing or reshaped in a real run', () => {
  let workDir: string;
  const reports = new Map<string, LoupeReport>();

  function run(scenario: string): LoupeReport {
    const known = reports.get(scenario);
    if (known) return known;
    const outputFolder = path.join(workDir, scenario);
    const result = playwright(['test', '--config', INTERNALS_CONFIG, '--output', path.join(workDir, `results-${scenario}`)], {
      LOUPE_FIXTURE_OUTPUT: outputFolder,
      LOUPE_FIXTURE_INTERNALS: scenario,
    });
    const report = readReport(outputFolder, `Exit code ${result.status}.\n${result.output}`);
    expect(result.status, result.output).toBe(0);
    expect(result.output).not.toMatch(/Error in reporter|TypeError/);
    reports.set(scenario, report);
    return report;
  }

  beforeAll(() => {
    assertBuilt();
    workDir = mkdtempSync(path.join(tmpdir(), 'loupe-internals-'));
  });

  afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it('reads the internals when Playwright provides them', () => {
    const report = run('present');
    expect(report.run.scopeReasons).toEqual(['only']);
    expect(report.run.workers).toEqual(expect.any(Number));
  }, 60_000);

  it.each(['missing', 'reshaped'])('produces the same tests and a valid report when the internals are %s', (scenario) => {
    const present = run('present');
    const report = run(scenario);
    expect(schemaErrors(report)).toEqual([]);
    expect(report.tests.map((test) => [test.id, test.outcome])).toEqual(present.tests.map((test) => [test.id, test.outcome]));
    expect(report.run.stats).toEqual(present.run.stats);
    // Less precise data: without `_only`, the test.only run is no longer seen as partial.
    expect(report.run.scopeReasons).toEqual([]);
    // `metadata.actualWorkers` falls back to `config.workers`.
    expect(report.run.workers).toEqual(expect.any(Number));
    // `configDir` falls back to the config file's folder: the same repository.
    expect(report.run.git).toEqual(present.run.git);
  }, 120_000);
});
