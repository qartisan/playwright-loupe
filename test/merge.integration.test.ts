import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LoupeReport } from '../src/schema/v1.js';
import { FIXTURE_CONFIG, ROOT, assertBuilt, findTest, playwright, readReport } from './helpers/fixtures.js';
import { schemaErrors } from './helpers/schema.js';

const MERGE_CONFIG = 'fixtures/merge.config.ts';
const SHARDS = 2;

describe('sharded fixture suite merged through Loupe', () => {
  let workDir: string;
  let mergedFolder: string;
  let mergeStatus: number | null;
  let merged: LoupeReport;
  /** Every test of the suite, from `--list`, as the reference. */
  let listed: LoupeReport;
  /** Merged without --config, from the fixtures directory. */
  let mergedFromCwd: LoupeReport;

  beforeAll(() => {
    assertBuilt();
    workDir = mkdtempSync(path.join(tmpdir(), 'loupe-merge-'));
    const blobs = path.join(workDir, 'blobs');
    mkdirSync(blobs);

    // Each shard writes its own blob folder (the blob reporter empties it first).
    for (let shard = 1; shard <= SHARDS; shard++) {
      const blobFolder = path.join(workDir, `blob-${shard}`);
      const result = playwright(
        [
          'test',
          '--config',
          FIXTURE_CONFIG,
          '--shard',
          `${shard}/${SHARDS}`,
          '--reporter',
          'blob',
          '--output',
          path.join(workDir, `test-results-${shard}`),
        ],
        { PLAYWRIGHT_BLOB_OUTPUT_DIR: blobFolder },
      );
      const zips = existsSync(blobFolder) ? readdirSync(blobFolder).filter((file) => file.endsWith('.zip')) : [];
      if (zips.length === 0) throw new Error(`Shard ${shard} produced no blob (exit code ${result.status}).\n${result.output}`);
      for (const zip of zips) copyFileSync(path.join(blobFolder, zip), path.join(blobs, zip));
    }

    mergedFolder = path.join(workDir, 'merged');
    const merge = playwright(['merge-reports', '--config', MERGE_CONFIG, blobs], { LOUPE_FIXTURE_OUTPUT: mergedFolder });
    mergeStatus = merge.status;
    merged = readReport(mergedFolder, `merge-reports exit code ${merge.status}.\n${merge.output}`);

    // Without --config, Loupe looks for its config file in the working directory.
    const cwdFolder = path.join(workDir, 'merged-cwd');
    const mergeFromCwd = playwright(
      ['merge-reports', '--reporter', path.join(ROOT, 'dist/index.js'), blobs],
      { LOUPE_OUTPUT_FOLDER: cwdFolder },
      path.join(ROOT, 'fixtures'),
    );
    mergedFromCwd = readReport(cwdFolder, `merge-reports (no config) exit code ${mergeFromCwd.status}.\n${mergeFromCwd.output}`);

    const listFolder = path.join(workDir, 'list');
    const list = playwright(['test', '--config', FIXTURE_CONFIG, '--list'], { LOUPE_FIXTURE_OUTPUT: listFolder });
    listed = readReport(listFolder, `--list exit code ${list.status}.\n${list.output}`);
  }, 360_000);

  afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it('merges without error', () => {
    expect(mergeStatus).toBe(0);
  });

  it('produces a valid schema v1 report', () => {
    expect(merged.schemaVersion).toBe(1);
    expect(schemaErrors(merged)).toEqual([]);
  });

  it('contains every test of the suite, with the same ids and paths as an unsharded run', () => {
    const key = (report: LoupeReport): string[] =>
      report.tests.map((test) => `${test.id} ${test.project} ${test.file} ${test.title}`).sort();
    expect(merged.tests.length).toBeGreaterThan(0);
    expect(key(merged)).toEqual(key(listed));
  });

  it('has no shard, a full scope and stats covering all shards', () => {
    expect(merged.run.shard).toBeNull();
    expect(merged.run.scope).toBe('full');
    expect(merged.run.stats.total).toBe(listed.tests.length);
    expect(merged.run.stats).toEqual({
      total: merged.tests.length,
      passed: merged.tests.filter((test) => test.outcome === 'passed').length,
      failed: merged.tests.filter((test) => test.outcome === 'failed').length,
      flaky: merged.tests.filter((test) => test.outcome === 'flaky').length,
      skipped: merged.tests.filter((test) => test.outcome === 'skipped').length,
    });
    expect(merged.run.stats.failed).toBeGreaterThan(0);
    expect(merged.run.stats.flaky).toBeGreaterThan(0);
  });

  it('keeps attempts and copies attachments from the blobs', () => {
    const flaky = findTest(merged, 'chromium-a', 'is flaky: fails on the first attempt, passes on retry (intentional)');
    expect(flaky.attempts.map((attempt) => attempt.status)).toEqual(['failed', 'passed']);

    const screenshot = findTest(merged, 'chromium-b', 'differs from the screenshot baseline (intentional)');
    const images = screenshot.attempts[0]?.attachments.filter((attachment) => attachment.comparison) ?? [];
    expect(images.map((image) => image.comparison?.role)).toEqual(['expected', 'actual', 'diff']);
    for (const image of images) expect(existsSync(path.join(mergedFolder, image.path ?? ''))).toBe(true);
  });

  it('applies the loupe.config.ts next to the merge config', () => {
    expect(merged.run.environment.name).toBe('fixtures');
    expect(findTest(merged, 'chromium-a', 'differs from the screenshot baseline (intentional)').category).toBe(
      'Visual regression',
    );
    expect(merged.dimensions.map((dimension) => dimension.name)).toEqual(['Layer', 'Bug', 'area']);
    expect(findTest(merged, 'chromium-b', 'fails on a wrong heading (intentional)').dimensions).toEqual({
      Layer: ['ui'],
      Bug: ['BUG-1'],
    });
  });

  it('looks up loupe.config.ts in the working directory without a merge config', () => {
    expect(schemaErrors(mergedFromCwd)).toEqual([]);
    expect(mergedFromCwd.run.environment.name).toBe('fixtures');
    expect(mergedFromCwd.categories.map((category) => category.name)).toContain('Visual regression');
    expect(mergedFromCwd.tests).toHaveLength(merged.tests.length);
  });

  it('keeps relative locations in errors', () => {
    const failing = findTest(merged, 'chromium-a', 'fails on a wrong heading (intentional)');
    expect(failing.attempts[0]?.errors[0]?.location?.file).toBe('basics.spec.ts');
  });
});
