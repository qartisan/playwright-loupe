import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LoupeReport, RunError } from '../src/schema/v1.js';
import { LOAD_ERROR_CONFIG, assertBuilt, playwright, readReport } from './helpers/fixtures.js';
import { schemaErrors } from './helpers/schema.js';

/** The error of fixtures/load-error/broken.spec.ts, which imports a module that does not exist. */
function expectLoadError(error: RunError | undefined): void {
  expect(error?.message).toMatch(/Cannot find module '.*missing-helper\.js' imported from .*broken\.spec\.ts/);
  // ES module spec files get `<anonymous>:1:1` from Playwright; Loupe recovers the file and the import line.
  expect(error?.location).toEqual({ file: 'broken.spec.ts', line: 3, column: 1 });
  expect(error?.signature).toMatch(/^[0-9a-f]{12}$/);
  expect(error?.category).toBe('Uncategorized');
  expect(error?.project).toBeNull();
}

describe('suite with a spec file that fails to load', () => {
  let workDir: string;
  let exitCode: number | null;
  let report: LoupeReport;
  let merged: LoupeReport;
  let mergeOutput: string;

  beforeAll(() => {
    assertBuilt();
    workDir = mkdtempSync(path.join(tmpdir(), 'loupe-load-error-'));

    const outputFolder = path.join(workDir, 'report');
    const run = playwright(['test', '--config', LOAD_ERROR_CONFIG], { LOUPE_FIXTURE_OUTPUT: outputFolder });
    exitCode = run.status;
    report = readReport(outputFolder, `Exit code ${exitCode}.\n${run.output}`);

    // The same run through a blob report and merge-reports.
    const blobFolder = path.join(workDir, 'blob');
    const blob = playwright(['test', '--config', LOAD_ERROR_CONFIG, '--reporter', 'blob'], {
      PLAYWRIGHT_BLOB_OUTPUT_DIR: blobFolder,
    });
    const zips = existsSync(blobFolder) ? readdirSync(blobFolder).filter((file) => file.endsWith('.zip')) : [];
    if (zips.length === 0) throw new Error(`No blob produced (exit code ${blob.status}).\n${blob.output}`);
    const blobs = path.join(workDir, 'blobs');
    mkdirSync(blobs);
    for (const zip of zips) copyFileSync(path.join(blobFolder, zip), path.join(blobs, zip));

    const mergedFolder = path.join(workDir, 'merged');
    const merge = playwright(['merge-reports', '--config', LOAD_ERROR_CONFIG, blobs], { LOUPE_FIXTURE_OUTPUT: mergedFolder });
    mergeOutput = merge.output;
    merged = readReport(mergedFolder, `merge-reports exit code ${merge.status}.\n${merge.output}`);
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
    expect(report.categories.map((category) => category.name)).toEqual(['Uncategorized']);
  });

  it('keeps the run error through a blob report and merge-reports', () => {
    expect(schemaErrors(merged)).toEqual([]);
    expect(merged.run.errors).toHaveLength(1);
    expectLoadError(merged.run.errors[0]);
    expect(merged.run.errors[0]?.signature).toBe(report.run.errors[0]?.signature);
    expect(mergeOutput).toContain('1 run error outside tests');
  });
});
