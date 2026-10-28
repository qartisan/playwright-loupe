import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LoupeReport } from '../src/schema/v1.js';
import { VERSION_CONFIG, assertBuilt, playwright, readReport } from './helpers/fixtures.js';
import { schemaErrors } from './helpers/schema.js';

interface VersionRun {
  status: number | null;
  output: string;
  report: LoupeReport;
}

/** What must not depend on the Playwright version warning. */
function outcome({ status, report }: VersionRun): unknown {
  return {
    status,
    runStatus: report.run.status,
    scope: report.run.scope,
    stats: report.run.stats,
    errors: report.run.errors,
    tests: report.tests.map((test) => [test.id, test.outcome]),
  };
}

const warnings = (output: string): string[] => output.split('\n').filter((line) => line.startsWith('[loupe] Playwright'));

/**
 * The run-time warning below the supported Playwright version, in real runs of
 * fixtures/version.config.ts, which replaces `config.version` before Loupe
 * reads it: same result on every Playwright version CI runs.
 */
describe('Playwright version warning in a real run', () => {
  let workDir: string;
  const runs = new Map<string, VersionRun>();

  function run(version: string): VersionRun {
    const known = runs.get(version);
    if (known) return known;
    const outputFolder = path.join(workDir, `report-${runs.size}`);
    const result = playwright(['test', '--config', VERSION_CONFIG, '--output', path.join(workDir, `results-${runs.size}`)], {
      LOUPE_FIXTURE_OUTPUT: outputFolder,
      LOUPE_FIXTURE_PLAYWRIGHT_VERSION: version,
    });
    const report = readReport(outputFolder, `Exit code ${result.status}.\n${result.output}`);
    const done = { ...result, report };
    runs.set(version, done);
    return done;
  }

  beforeAll(() => {
    assertBuilt();
    workDir = mkdtempSync(path.join(tmpdir(), 'loupe-version-'));
  });

  afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it('writes one warning line below the supported version, and still passes', () => {
    const below = run('1.55.0');
    expect(below.status, below.output).toBe(0);
    expect(warnings(below.output)).toEqual([
      expect.stringMatching(/^\[loupe\] Playwright 1\.55\.0 is below the minimum supported version \(1\.\d+\)\. The report is generated/),
    ]);
  }, 60_000);

  it('writes nothing on a supported version, a prerelease of one, or an unreadable version', () => {
    for (const version of ['1.57.0', '1.65.0-alpha-2026-10-28', '', 'unknown']) {
      const result = run(version);
      expect(result.status, result.output).toBe(0);
      expect(warnings(result.output), `version "${version}"`).toEqual([]);
    }
  }, 120_000);

  it('produces the same report with or without the warning', () => {
    const below = run('1.55.0');
    const supported = run('1.57.0');
    expect(schemaErrors(below.report)).toEqual([]);
    expect(outcome(below)).toEqual(outcome(supported));
    expect(below.report.run.playwrightVersion).toBe('1.55.0');
  }, 120_000);
});
