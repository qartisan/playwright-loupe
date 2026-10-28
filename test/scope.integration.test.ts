import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LoupeReport } from '../src/schema/v1.js';
import { SCOPE_CONFIG, SCOPE_DEFAULT_CONFIG, assertBuilt, playwright, readReport } from './helpers/fixtures.js';

const { version } = createRequire(import.meta.url)('@playwright/test/package.json') as { version: string };
const [major = 0, minor = 0] = version.split('.').map(Number);
/** `default: false` on a project exists from Playwright 1.64. */
const SUPPORTS_DEFAULT_PROJECTS = major > 1 || (major === 1 && minor >= 64);

/**
 * Run scope detection against real Playwright runs. CI runs it on the minimum
 * supported Playwright version and the latest one, which covers both the
 * `config.argv` / `config.filteredProjects` paths and their fallbacks
 * (`process.argv`, projects present in the run).
 */
describe('run scope with a real Playwright run', () => {
  let workDir: string;

  /** Runs fixtures/scope.config.ts (or `config`) with extra arguments; the reporter must exit cleanly. */
  function run(name: string, args: string[], config: string = SCOPE_CONFIG): LoupeReport {
    const outputFolder = path.join(workDir, name);
    const result = playwright(['test', '--config', config, '--output', path.join(workDir, `results-${name}`), ...args], {
      LOUPE_FIXTURE_OUTPUT: outputFolder,
    });
    const report = readReport(outputFolder, `Exit code ${result.status}.\n${result.output}`);
    expect(result.status, result.output).toBe(0);
    return report;
  }

  const ran = (report: LoupeReport): string[] => report.tests.map((test) => `${test.project} > ${test.title}`).sort();

  beforeAll(() => {
    assertBuilt();
    workDir = mkdtempSync(path.join(tmpdir(), 'loupe-scope-'));
  });

  afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  // `test.only` is read from Playwright's internal `_only` flag: this breaks if Playwright changes it.
  it('reports a test.only run as partial, with the only reason alone', () => {
    const report = run('only', []);
    // Dependency projects run their tests in full.
    expect(ran(report)).toEqual(['main > runs alone', 'setup > prepares']);
    expect(report.run.scope).toBe('partial');
    expect(report.run.scopeReasons).toEqual(['only']);
  }, 60_000);

  it('reads file filters from the command line', () => {
    const report = run('file-filter', ['plain.spec.ts']);
    expect(ran(report)).toEqual(['main > runs when selected', 'setup > prepares']);
    expect(report.run.scopeReasons).toEqual(['file-filter']);
  }, 60_000);

  it('does not treat a project needed as a dependency as left out', () => {
    const report = run('project', ['plain.spec.ts', '--project', 'main']);
    expect(ran(report)).toEqual(['main > runs when selected', 'setup > prepares']);
    expect(report.run.scopeReasons).toEqual(['file-filter']);
  }, 60_000);

  it('gives --project all its values', () => {
    const report = run('projects', ['plain.spec.ts', '--project', 'setup', 'main']);
    expect(report.run.scopeReasons).toEqual(['file-filter']);
  }, 60_000);

  it('treats dependencies skipped by --no-deps as left out', () => {
    const report = run('no-deps', ['plain.spec.ts', '--no-deps', '--project', 'main']);
    expect(ran(report)).toEqual(['main > runs when selected']);
    expect(report.run.scope).toBe('partial');
    expect(report.run.scopeReasons).toEqual(['file-filter', 'project-filter']);
  }, 60_000);

  // Skipped below Playwright 1.64, where `default` does not exist.
  describe.runIf(SUPPORTS_DEFAULT_PROJECTS)('with a default: false project (Playwright 1.64+)', () => {
    // The only case that tells Playwright's internal `default` flag from its
    // fallback: without the flag, the missing `nightly` makes the run partial.
    it('reports the default projects selected with --project as full: the non-default one is not a reference', () => {
      const report = run('default-main', ['--project', 'main'], SCOPE_DEFAULT_CONFIG);
      expect(ran(report)).toEqual(['main > runs when selected', 'setup > prepares']);
      expect(report.run.scope).toBe('full');
      expect(report.run.scopeReasons).toEqual([]);
    }, 60_000);

    it('reports a plain run as full although the non-default project did not run', () => {
      const report = run('default-plain', [], SCOPE_DEFAULT_CONFIG);
      expect(ran(report)).toEqual(['main > runs when selected', 'setup > prepares']);
      expect(report.run.scope).toBe('full');
      expect(report.run.scopeReasons).toEqual([]);
    }, 60_000);

    it('reports the non-default project alone as partial: the default projects are missing', () => {
      const report = run('default-nightly', ['--project', 'nightly'], SCOPE_DEFAULT_CONFIG);
      expect(ran(report)).toEqual(['nightly > runs when selected']);
      expect(report.run.scope).toBe('partial');
      expect(report.run.scopeReasons).toEqual(['project-filter']);
    }, 60_000);

    it('reports the default projects plus the non-default one as full', () => {
      const report = run('default-all', ['--project', 'main', 'nightly'], SCOPE_DEFAULT_CONFIG);
      expect(ran(report)).toEqual(['main > runs when selected', 'nightly > runs when selected', 'setup > prepares']);
      expect(report.run.scope).toBe('full');
      expect(report.run.scopeReasons).toEqual([]);
    }, 60_000);
  });
});
