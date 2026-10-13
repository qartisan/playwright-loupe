import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LoupeReport, Step, TestCase } from '../../src/schema/v1.js';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const FIXTURE_CONFIG = 'fixtures/playwright.config.ts';
export const LOAD_ERROR_CONFIG = 'fixtures/load-error.config.ts';

/** Fails early with a clear message when the reporter was not built. */
export function assertBuilt(): void {
  for (const file of ['dist/index.js', 'dist/renderer/index.html']) {
    if (!existsSync(path.join(ROOT, file))) {
      throw new Error('Build output missing: run `npm run build` first (`npm test` does it via pretest).');
    }
  }
}

/** Runs `npx playwright <args>`, from the repository root unless `cwd` is given. */
export function playwright(
  args: string[],
  env: Record<string, string> = {},
  cwd: string = ROOT,
): { status: number | null; output: string } {
  const result = spawnSync('npx', ['playwright', ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
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
