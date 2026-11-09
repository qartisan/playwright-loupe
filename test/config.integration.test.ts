import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_CONFIG, UNKNOWN_OPTIONS_CONFIG, assertBuilt, playwright, readReport } from './helpers/fixtures.js';

// `--list` builds the reporters like a real run, without running any test.

describe('config loading in a real run', () => {
  let workDir: string;

  beforeAll(() => {
    assertBuilt();
    workDir = mkdtempSync(path.join(tmpdir(), 'loupe-config-'));
  });

  afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it('stops the run on an invalid config, naming the key and suggesting the right one', () => {
    const outputFolder = path.join(workDir, 'invalid');
    const result = playwright(['test', '--config', FIXTURE_CONFIG], {
      LOUPE_CONFIG: 'fixtures/invalid.loupe.config.ts',
      LOUPE_FIXTURE_OUTPUT: outputFolder,
    });
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('Loupe: invalid configuration.');
    expect(result.output).toContain('invalid.loupe.config.ts: titel is not a known option. Did you mean "title"?');
    // Stopped before running any test: no test result line, no report.
    expect(result.output).not.toMatch(/\d+ passed/);
    expect(existsSync(outputFolder)).toBe(false);
  }, 120_000);

  it('lists with unknown inline options, as Playwright 1.65 gives them: one warning, and the report', () => {
    const outputFolder = path.join(workDir, 'unknown-list');
    const result = playwright(['test', '--config', UNKNOWN_OPTIONS_CONFIG, '--list'], { LOUPE_FIXTURE_OUTPUT: outputFolder });
    expect(result.status, result.output).toBe(0);
    const warnings = result.output.split('\n').filter((line) => line.startsWith('Loupe: reporter options'));
    expect(warnings).toEqual([
      'Loupe: reporter options: ignoring unknown options futureKey, categories.rulez (did you mean "rules"?).',
    ]);
    const report = readReport(outputFolder, `Exit code ${result.status}.\n${result.output}`);
    expect(report.tests.map((test) => test.title)).toEqual(['runs when selected']);
  }, 120_000);

  it('runs with onlyFailures outside --list: it warns that the report keeps every test', () => {
    const outputFolder = path.join(workDir, 'unknown-run');
    const result = playwright(['test', '--config', UNKNOWN_OPTIONS_CONFIG], { LOUPE_FIXTURE_OUTPUT: outputFolder });
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain(
      'Loupe: reporter options: onlyFailures is not supported by Loupe and is ignored; the report keeps every test.',
    );
    expect(result.output).toContain('Loupe: reporter options: ignoring unknown options futureKey, categories.rulez');
    expect(readReport(outputFolder, result.output).tests).toHaveLength(1);
  }, 120_000);

  it('stops the run when LOUPE_CONFIG points to a missing file', () => {
    const result = playwright(['test', '--config', FIXTURE_CONFIG, '--list'], { LOUPE_CONFIG: 'nowhere/loupe.config.ts' });
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/LOUPE_CONFIG=nowhere\/loupe\.config\.ts: config file not found at /);
  }, 120_000);

  it('applies environment variables over the config file and inline options', () => {
    const outputFolder = path.join(workDir, 'env');
    const result = playwright(['test', '--config', FIXTURE_CONFIG, '--list'], {
      LOUPE_OUTPUT_FOLDER: outputFolder,
      LOUPE_TITLE: 'Title from the environment',
      LOUPE_ENV: 'env-name',
    });
    const report = readReport(outputFolder, `Exit code ${result.status}.\n${result.output}`);
    expect(report.run.environment.name).toBe('env-name');
    const html = readFileSync(path.join(outputFolder, 'index.html'), 'utf8');
    expect(html).toContain('{"title":"Title from the environment","theme":"dark","screenshots":{"defaultView":"slider"},"aiPrompt":{"includeStack":true},"traceViewer":null}');
  }, 120_000);
});
