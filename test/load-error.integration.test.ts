import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LoupeReport, RunError } from '../src/schema/v1.js';
import { LOAD_ERROR_CONFIG, assertBuilt, playwright, readReport } from './helpers/fixtures.js';
import { schemaErrors } from './helpers/schema.js';

const TAG = '@shard-a';

/** The error of fixtures/load-error/broken.spec.ts, which imports a module that does not exist. */
function expectLoadError(error: RunError | undefined): void {
  expect(error?.message).toMatch(/^Error: Cannot find module '.*missing-helper\.js' imported from .*broken\.spec\.ts/);
  // ES module spec files get `<anonymous>:1:1` from Playwright; Loupe recovers the file and the import line.
  expect(error?.location).toEqual({ file: 'broken.spec.ts', line: 3, column: 1 });
  expect(error?.signature).toMatch(/^[0-9a-f]{12}$/);
  // The fixture config has a rule anchored with ^ for it.
  expect(error?.category).toBe('Missing module');
  expect(error?.project).toBeNull();
}

describe('suite with a spec file that fails to load', () => {
  let workDir: string;
  let exitCode: number | null;
  let report: LoupeReport;
  let merged: LoupeReport;
  let mergeOutput: string;
  /** Merged from a blob whose config has a `tag`. */
  let mergedTagged: LoupeReport;

  beforeAll(() => {
    assertBuilt();
    workDir = mkdtempSync(path.join(tmpdir(), 'loupe-load-error-'));

    const outputFolder = path.join(workDir, 'report');
    const run = playwright(['test', '--config', LOAD_ERROR_CONFIG], { LOUPE_FIXTURE_OUTPUT: outputFolder });
    exitCode = run.status;
    report = readReport(outputFolder, `Exit code ${exitCode}.\n${run.output}`);

    // The same run through a blob report and merge-reports.
    /** Runs the suite with the blob reporter, merges the blob and returns the merged report and output. */
    const blobAndMerge = (name: string, env: Record<string, string> = {}): { report: LoupeReport; output: string } => {
      const blobFolder = path.join(workDir, `blob-${name}`);
      const blob = playwright(['test', '--config', LOAD_ERROR_CONFIG, '--reporter', 'blob'], {
        ...env,
        PLAYWRIGHT_BLOB_OUTPUT_DIR: blobFolder,
      });
      const zips = existsSync(blobFolder) ? readdirSync(blobFolder).filter((file) => file.endsWith('.zip')) : [];
      if (zips.length === 0) throw new Error(`No blob produced (exit code ${blob.status}).\n${blob.output}`);
      const blobs = path.join(workDir, `blobs-${name}`);
      mkdirSync(blobs);
      for (const zip of zips) copyFileSync(path.join(blobFolder, zip), path.join(blobs, zip));

      const mergedFolder = path.join(workDir, `merged-${name}`);
      const merge = playwright(['merge-reports', '--config', LOAD_ERROR_CONFIG, blobs], { LOUPE_FIXTURE_OUTPUT: mergedFolder });
      return { report: readReport(mergedFolder, `merge-reports exit code ${merge.status}.\n${merge.output}`), output: merge.output };
    };
    ({ report: merged, output: mergeOutput } = blobAndMerge('plain'));
    ({ report: mergedTagged } = blobAndMerge('tagged', { LOUPE_FIXTURE_TAG: TAG }));
  }, 240_000);

  afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it('fails the run', () => {
    expect(exitCode).toBe(1);
    expect(report.run.status).toBe('failed');
  });

  it('produces a valid report with zero tests', () => {
    expect(schemaErrors(report)).toEqual([]);
    // A load error stops Playwright before any test runs, the healthy file included.
    expect(report.tests).toEqual([]);
    expect(report.projects).toEqual([]);
    expect(report.run.stats.total).toBe(0);
  });

  it('records the load error in run.errors, with its file and location', () => {
    expect(report.run.errors).toHaveLength(1);
    expectLoadError(report.run.errors[0]);
    expect(report.categories.map((category) => category.name)).toEqual(['Missing module']);
  });

  it('keeps the run error through a blob report and merge-reports', () => {
    expect(schemaErrors(merged)).toEqual([]);
    expect(merged.run.errors).toHaveLength(1);
    expectLoadError(merged.run.errors[0]);
    expect(merged.run.errors[0]?.signature).toBe(report.run.errors[0]?.signature);
    expect(mergeOutput).toContain('1 run error outside tests');
  });

  it('keeps the signature when merge-reports prefixes the error with the shard tag', () => {
    expect(schemaErrors(mergedTagged)).toEqual([]);
    expect(mergedTagged.run.errors).toHaveLength(1);
    const error = mergedTagged.run.errors[0];
    // Playwright adds the prefix from 1.57. The message and stack keep it: it tells which shard the error comes from.
    const [major = 0, minor = 0] = mergedTagged.run.playwrightVersion.split('.').map(Number);
    const prefix = major > 1 || minor >= 57 ? `(${TAG}) ` : '';
    expect(error?.message.startsWith(`${prefix}Error: `)).toBe(true);
    expect(error?.stack?.startsWith(`${prefix}Error: `)).toBe(true);
    expectLoadError({ ...error, message: error?.message.slice(prefix.length) } as RunError);
    expect(error?.signature).toBe(report.run.errors[0]?.signature);
    // expectLoadError checked the category: the ^-anchored rule matches despite the prefix.
    expect(mergedTagged.categories.map((category) => category.name)).toEqual(['Missing module']);
  });
});
