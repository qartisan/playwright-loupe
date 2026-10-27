import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { errorSignature } from '../src/core/signature.js';
import type { LoupeError, LoupeReport, Step, TestCase } from '../src/schema/v1.js';
import { ROOT, assertBuilt, playwright, readReport } from './helpers/fixtures.js';
import { schemaErrors } from './helpers/schema.js';

/**
 * fixtures/paths copied under two fake absolute roots, each in a fake home:
 * A (`…/a/home/alice/shop`) for a direct run and a blob, B
 * (`…/b/home/bob/merge`) for `merge-reports -c` on that blob. The report must
 * hold no absolute path of either, and stacks and locations must be relative
 * to the root dir.
 */

const HELPER = 'fails in a helper outside the root (intentional)';
const UNDER_ROOT = 'reads a missing file under the root (intentional)';
const IN_HOME = 'reads a missing file in the home directory (intentional)';
const FRAMELESS = 'throws an error without frames (intentional)';
const PRINTS = 'prints paths';

/** A copy of fixtures/paths at `root`, resolving packages from the repository. */
function copySuite(root: string): void {
  mkdirSync(path.dirname(root), { recursive: true });
  cpSync(path.join(ROOT, 'fixtures/paths'), root, { recursive: true });
  symlinkSync(path.join(ROOT, 'node_modules'), path.join(root, 'node_modules'), 'junction');
}

function find(report: LoupeReport, title: string): TestCase {
  const test = report.tests.find((candidate) => candidate.title === title);
  if (!test) throw new Error(`No test "${title}"`);
  return test;
}

function firstError(test: TestCase): LoupeError {
  const error = test.attempts[0]?.errors[0];
  if (!error) throw new Error(`No error in "${test.title}"`);
  return error;
}

function allErrors(report: LoupeReport): LoupeError[] {
  const fromSteps = (steps: readonly Step[]): LoupeError[] => steps.flatMap((step) => [...(step.error ? [step.error] : []), ...fromSteps(step.steps)]);
  return [
    ...report.run.errors,
    ...report.tests.flatMap((test) => test.attempts.flatMap((attempt) => [...attempt.errors, ...fromSteps(attempt.steps)])),
  ];
}

describe('paths in the report', () => {
  let workDir: string;
  let rootA: string;
  let rootB: string;
  let homeA: string;
  let directFolder: string;
  let mergedFolder: string;
  let directStatus: number | null;
  let mergeStatus: number | null;
  let direct: LoupeReport;
  let merged: LoupeReport;
  /** The roots Loupe derives from the stacks of the direct run, written by fixtures/paths/roots-reporter.ts. */
  let derived: { rootDir: string; roots: string[] };

  beforeAll(() => {
    assertBuilt();
    // Real path: on macOS the temporary directory is behind a symlink, and stacks show the real one.
    workDir = realpathSync(mkdtempSync(path.join(tmpdir(), 'loupe-paths-')));
    homeA = path.join(workDir, 'a', 'home', 'alice');
    const homeB = path.join(workDir, 'b', 'home', 'bob');
    rootA = path.join(homeA, 'shop');
    rootB = path.join(homeB, 'merge');
    copySuite(rootA);
    copySuite(rootB);

    const env = {
      LOUPE_FIXTURE_REPORTER: path.join(ROOT, 'dist/index.js'),
      // npx keeps its cache in the real home.
      npm_config_cache: path.join(homedir(), '.npm'),
    };
    const as = (home: string) => ({ ...env, HOME: home, USERPROFILE: home });
    const configA = path.join(rootA, 'playwright.config.ts');

    directFolder = path.join(workDir, 'direct');
    const rootsFile = path.join(workDir, 'roots.json');
    const run = playwright(['test', '--config', configA], {
      ...as(homeA),
      LOUPE_FIXTURE_OUTPUT: directFolder,
      LOUPE_FIXTURE_ROOTS: rootsFile,
      LOUPE_FIXTURE_BUILD: path.join(ROOT, 'dist/core/build.js'),
    });
    directStatus = run.status;
    direct = readReport(directFolder, `Exit code ${run.status}.\n${run.output}`);
    derived = JSON.parse(readFileSync(rootsFile, 'utf8')) as typeof derived;

    const blobFolder = path.join(workDir, 'blob');
    const blob = playwright(['test', '--config', configA, '--reporter', 'blob'], { ...as(homeA), PLAYWRIGHT_BLOB_OUTPUT_DIR: blobFolder });
    const zips = existsSync(blobFolder) ? readdirSync(blobFolder).filter((file) => file.endsWith('.zip')) : [];
    if (zips.length === 0) throw new Error(`No blob produced (exit code ${blob.status}).\n${blob.output}`);

    mergedFolder = path.join(workDir, 'merged');
    const merge = playwright(['merge-reports', '--config', path.join(rootB, 'playwright.config.ts'), blobFolder], {
      ...as(homeB),
      LOUPE_FIXTURE_OUTPUT: mergedFolder,
    });
    mergeStatus = merge.status;
    merged = readReport(mergedFolder, `merge-reports exit code ${merge.status}.\n${merge.output}`);
  }, 240_000);

  afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it('runs the suite and merges its blob', () => {
    expect(directStatus).toBe(1);
    expect(mergeStatus).toBe(0);
  });

  it('produces valid schema v1 reports', () => {
    expect(schemaErrors(direct)).toEqual([]);
    expect(schemaErrors(merged)).toEqual([]);
  });

  it('derives no root but the root dir from the stacks of a direct run', () => {
    expect(derived.rootDir).toBe(path.join(rootA, 'tests'));
    expect(derived.roots.length).toBeGreaterThan(0);
    expect(derived.roots.every((root) => root === derived.rootDir)).toBe(true);
  });

  it('leaves no absolute path of the run in report.json and index.html', () => {
    for (const file of ['report.json', 'index.html']) {
      const text = readFileSync(path.join(directFolder, file), 'utf8');
      expect(text, file).not.toContain(workDir);
      expect(text, file).not.toContain('alice');
    }
  });

  it('leaves no absolute path of either root in a merged report', () => {
    for (const file of ['report.json', 'index.html']) {
      const text = readFileSync(path.join(mergedFolder, file), 'utf8');
      expect(text, file).not.toContain(rootA);
      expect(text, file).not.toContain(rootB);
    }
  });

  it('writes stacks and locations relative to the root dir, merged or not', () => {
    for (const report of [direct, merged]) {
      const test = find(report, HELPER);
      const error = firstError(test);
      expect(error.location?.file).toBe('../shared/helper.ts');
      expect(error.stack).toMatch(/^ {4}at expectTwo \(\.\.\/shared\/helper\.ts:\d+:\d+\)$/m);
      expect(error.stack).toMatch(/^ {4}at paths\.spec\.ts:\d+:\d+$/m);
      const step = test.attempts[0]?.steps.find((candidate) => candidate.category === 'test.step');
      expect(step?.title).toBe('checks .');
      expect(step?.error?.stack).toContain('(../shared/helper.ts:');
      expect(step?.location?.file).toBe('paths.spec.ts');
    }
  });

  it('rewrites paths in messages: relative under the root, `~` in the home', () => {
    expect(firstError(find(direct, UNDER_ROOT)).message).toBe("Error: ENOENT: no such file or directory, open 'missing.json'");
    expect(firstError(find(direct, IN_HOME)).message).toBe("Error: ENOENT: no such file or directory, open '~/.cache/loupe-missing.json'");
  });

  it('rewrites a stack exactly like its message, so a frameless stack still equals it', () => {
    const error = firstError(find(direct, FRAMELESS));
    expect(error.message).toBe('Error: frameless: data.json');
    expect(error.stack).toBe(error.message);
    for (const each of allErrors(direct)) {
      if (each.stack !== null && !/^\s+at /m.test(each.stack)) expect(each.stack).toBe(each.message);
    }
  });

  it('rewrites outputs, annotations, step titles and text attachments', () => {
    const test = find(direct, PRINTS);
    const attempt = test.attempts[0];
    expect(attempt?.stdout.text).toBe('root=. home=~\n');
    expect(attempt?.annotations).toContainEqual({ type: 'root', description: '.' });
    expect(attempt?.attachments.find((attachment) => attachment.name === 'paths')?.body).toBe('.\n~');
  });

  it('computes signatures from the original text', () => {
    const original = `Error: ENOENT: no such file or directory, open '${path.join(rootA, 'tests', 'missing.json')}'`;
    expect(firstError(find(direct, UNDER_ROOT)).signature).toBe(errorSignature(original));
  });

  it('gives the same ids, signatures and categories merged or not', () => {
    const summary = (report: LoupeReport) =>
      report.tests.map((test) => ({ id: test.id, title: test.title, errors: allErrors({ ...report, run: { ...report.run, errors: [] }, tests: [test] }).map((error) => [error.signature, error.category]) }));
    expect(summary(merged)).toEqual(summary(direct));
  });
});
