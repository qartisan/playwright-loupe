import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConsoleMessage, Page } from '@playwright/test';
import type { LoupeReport, Step, TestCase } from '../../src/schema/v1.js';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const FIXTURE_CONFIG = 'fixtures/playwright.config.ts';
export const LOAD_ERROR_CONFIG = 'fixtures/load-error.config.ts';
export const SCOPE_CONFIG = 'fixtures/scope.config.ts';
export const SCOPE_DEFAULT_CONFIG = 'fixtures/scope-default.config.ts';
export const VERSION_CONFIG = 'fixtures/version.config.ts';
export const INTERNALS_CONFIG = 'fixtures/internals.config.ts';
export const RERUN_CONFIG = 'fixtures/rerun.config.ts';

/** Fails early with a clear message when the reporter was not built. */
export function assertBuilt(): void {
  for (const file of ['dist/index.js', 'dist/renderer/index.html']) {
    if (!existsSync(path.join(ROOT, file))) {
      throw new Error('Build output missing: run `npm run build` first (`npm test` does it via pretest).');
    }
  }
}

/**
 * Runs `npx playwright <args>`, from the repository root unless `cwd` is given.
 *
 * Each run gets its own transform cache, removed afterwards. Vitest runs test
 * files in parallel, so several runs compile the same fixture files at once;
 * from Playwright 1.56, a run that compiles a file deletes the cached entries
 * of that file, including the source map another run has just written, and
 * that run then reports test lines of the compiled file
 * (https://github.com/microsoft/playwright/issues/43601). `PWTEST_CACHE_DIR`
 * is undocumented, but it is the workaround the Playwright maintainers advise
 * there.
 */
export function playwright(
  args: string[],
  env: Record<string, string> = {},
  cwd: string = ROOT,
): { status: number | null; output: string } {
  const cacheDir = mkdtempSync(path.join(tmpdir(), 'loupe-pw-cache-'));
  try {
    const result = spawnSync('npx', ['playwright', ...args], {
      cwd,
      env: { ...process.env, PWTEST_CACHE_DIR: cacheDir, ...env },
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
    return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
}

/**
 * Runs `command` as pasted in a shell (bash; cmd.exe on Windows), from the
 * repository root. Asynchronous, so that several can run at once, each with
 * its own transform cache (see `playwright`).
 */
export async function pasteInShell(command: string, env: Record<string, string> = {}): Promise<{ status: number | null; output: string }> {
  const cacheDir = mkdtempSync(path.join(tmpdir(), 'loupe-pw-cache-'));
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(command, {
        cwd: ROOT,
        env: { ...process.env, PWTEST_CACHE_DIR: cacheDir, ...env },
        shell: process.platform === 'win32' ? true : 'bash',
      });
      let output = '';
      child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
      child.on('error', reject);
      child.on('close', (status) => resolve({ status, output }));
    });
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
}

export function readReport(outputFolder: string, context: string): LoupeReport {
  const reportFile = path.join(outputFolder, 'report.json');
  if (!existsSync(reportFile)) throw new Error(`No report produced.\n${context}`);
  return JSON.parse(readFileSync(reportFile, 'utf8')) as LoupeReport;
}

export function findTest(report: LoupeReport, project: string, title: string): TestCase {
  const test = report.tests.find((candidate) => candidate.project === project && candidate.title === title);
  if (!test) throw new Error(`No test "${title}" in project ${project}`);
  return test;
}

/** Titles of the `test.step` steps only, nested: stable across Playwright versions. */
export function userSteps(steps: Step[]): unknown[] {
  return steps.flatMap((step) => {
    const children = userSteps(step.steps);
    if (step.category !== 'test.step') return children;
    return [children.length > 0 ? { [step.title]: children } : step.title];
  });
}

/**
 * A console error for an attachment file missing under the report's `data/`
 * folder: expected when a test report is written without its attachment
 * files. Any other missing file (the bundle, the report itself) is not.
 */
export function isMissingAttachmentFile(message: ConsoleMessage, page: Page): boolean {
  if (message.type() !== 'error' || !message.text().includes('net::ERR_FILE_NOT_FOUND')) return false;
  return message.location().url.startsWith(new URL('data/', page.url()).href);
}
