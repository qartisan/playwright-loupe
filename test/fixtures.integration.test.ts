import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PlaceholderReport } from '../src/core/model.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUILT_REPORTER = path.join(ROOT, 'dist/index.js');
const BUILT_TEMPLATE = path.join(ROOT, 'dist/renderer/index.html');

/** Replaces values that change between runs and machines. */
function normalize(report: PlaceholderReport): unknown {
  return {
    ...report,
    run: {
      ...report.run,
      startTime: '<startTime>',
      duration: '<duration>',
      playwrightVersion: '<playwrightVersion>',
    },
    tests: report.tests.map((test) => ({ ...test, file: test.file.replaceAll(ROOT, '<root>/') })),
  };
}

describe('fixture suite with the built reporter', () => {
  let workDir: string;
  let exitCode: number | null;
  let report: PlaceholderReport;
  let html: string;

  beforeAll(() => {
    if (!existsSync(BUILT_REPORTER) || !existsSync(BUILT_TEMPLATE)) {
      throw new Error('Build output missing: run `npm run build` first (`npm test` does it via pretest).');
    }
    workDir = mkdtempSync(path.join(tmpdir(), 'loupe-fixtures-'));
    const outputFolder = path.join(workDir, 'report');

    const result = spawnSync(
      'npx',
      ['playwright', 'test', '--config', 'fixtures/playwright.config.ts', '--output', path.join(workDir, 'test-results')],
      {
        cwd: ROOT,
        env: { ...process.env, LOUPE_FIXTURE_OUTPUT: outputFolder },
        encoding: 'utf8',
        shell: process.platform === 'win32',
      },
    );
    exitCode = result.status;

    const reportFile = path.join(outputFolder, 'report.json');
    if (!existsSync(reportFile)) {
      throw new Error(`No report produced (exit code ${exitCode}).\n${result.stdout}\n${result.stderr}`);
    }
    report = JSON.parse(readFileSync(reportFile, 'utf8')) as PlaceholderReport;
    html = readFileSync(path.join(outputFolder, 'index.html'), 'utf8');
  }, 180_000);

  afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it('exits with code 1 because of the intentional failures', () => {
    expect(exitCode).toBe(1);
  });

  it('reports every expected status', () => {
    expect(report.schemaVersion).toBe(0);
    expect(report.run.status).toBe('failed');
    expect(new Set(report.tests.map((test) => test.status))).toEqual(
      new Set(['passed', 'failed', 'flaky', 'skipped']),
    );
  });

  it('counts retries as attempts', () => {
    const flaky = report.tests.filter((test) => test.status === 'flaky');
    expect(flaky.map((test) => test.attempts)).toEqual([2, 2]);
  });

  it('embeds the same data in index.html', () => {
    const open = '<script id="loupe-data" type="application/json">';
    const start = html.indexOf(open) + open.length;
    const embedded: unknown = JSON.parse(html.slice(start, html.indexOf('</script>', start)));
    expect(embedded).toEqual(report);
  });

  it('matches the normalized snapshot', () => {
    expect(normalize(report)).toMatchSnapshot();
  });
});
