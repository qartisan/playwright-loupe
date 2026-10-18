import type { TestCase } from '../../schema/v1.js';

/**
 * Rerun commands, to paste in a POSIX shell (bash, zsh) from the Playwright
 * root directory: paths in the report are relative to it.
 *
 *   npx playwright test tests/login.spec.ts:12 --project=chromium
 *
 * `file:line` reruns every test declared on that line (a test in a loop
 * included), so tests sharing a `file:line` give one argument. Arguments are
 * sorted by file, then line. Projects with exactly the same arguments share
 * one command (`--project=a --project=b`); otherwise each project gets its
 * own command, joined with `&&`: one command for both would run every file
 * in every project.
 *
 * Pure functions, no DOM: unit-tested in Node.
 */

export type RerunTarget = Pick<TestCase, 'file' | 'line' | 'project'>;

/** Above this many tests, the command is long enough to deserve a notice. */
export const LONG_COMMAND_TESTS = 100;

/** Left unquoted: letters, digits and `_@%+=:,./-`. */
const SAFE = /^[\w@%+=:,./-]+$/;

/** An argument for a POSIX shell: as is when safe, single-quoted otherwise. */
export function shellQuote(value: string): string {
  if (SAFE.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The distinct `file:line` locations of each project, sorted by file then line; projects in order of first appearance. */
export function locationsByProject(tests: readonly RerunTarget[]): Map<string, string[]> {
  const byProject = new Map<string, Map<string, RerunTarget>>();
  for (const test of tests) {
    let locations = byProject.get(test.project);
    if (!locations) {
      locations = new Map();
      byProject.set(test.project, locations);
    }
    locations.set(`${test.file}:${test.line}`, test);
  }
  return new Map(
    [...byProject].map(([project, locations]) => [
      project,
      [...locations.values()].sort((a, b) => compareText(a.file, b.file) || a.line - b.line).map((test) => `${test.file}:${test.line}`),
    ]),
  );
}

/** One command; `--project` is left out for an unnamed project, which no flag can select. */
function command(locations: readonly string[], projects: readonly string[]): string {
  const flags = projects.filter((project) => project !== '').map((project) => `--project=${shellQuote(project)}`);
  return ['npx playwright test', ...locations.map(shellQuote), ...flags].join(' ');
}

/**
 * The command rerunning `tests`. Projects with the same set of `file:line`
 * arguments share one command; different sets give one command each, joined
 * with `&&`. An unnamed project always has its own command. Empty when there
 * is no test.
 */
export function rerunCommand(tests: readonly RerunTarget[]): string {
  const groups = new Map<string, { locations: string[]; projects: string[] }>();
  for (const [project, locations] of locationsByProject(tests)) {
    const key = project === '' ? '\0unnamed' : locations.join('\0');
    const group = groups.get(key);
    if (group) group.projects.push(project);
    else groups.set(key, { locations, projects: [project] });
  }
  return [...groups.values()].map(({ locations, projects }) => command(locations, projects)).join(' && ');
}

/** Tests that finally failed; flaky tests passed on a retry and are left out. */
export function failedTests<T extends Pick<TestCase, 'outcome'>>(tests: readonly T[]): T[] {
  return tests.filter((test) => test.outcome === 'failed');
}

/** The failed tests of the run declared in the same file as `test`, every project included. */
export function failedTestsInFile<T extends Pick<TestCase, 'outcome' | 'file'>>(tests: readonly T[], file: string): T[] {
  return failedTests(tests).filter((test) => test.file === file);
}

/**
 * The "failed tests in this file" rerun of a test detail: the failed tests of
 * its file, every project included. Null unless the file has a failed test
 * at another line than `test`: the same test failing in several projects is
 * not "other failed tests".
 */
export function fileRerun<T extends RerunTarget & Pick<TestCase, 'outcome'>>(
  tests: readonly T[],
  test: RerunTarget,
): { tests: T[]; label: string } | null {
  const inFile = failedTestsInFile(tests, test.file);
  if (!inFile.some((other) => other.line !== test.line)) return null;
  const counts = [...locationsByProject(inFile)].map(([project, locations]) => ({ project: project || '(unnamed project)', count: locations.length }));
  const noun = (count: number): string => (count === 1 ? 'failed test' : 'failed tests');
  const [first] = counts;
  if (counts.length === 1 && first) return { tests: inFile, label: `${first.count} ${noun(first.count)} in this file` };
  if (first && counts.every(({ count }) => count === first.count)) {
    return { tests: inFile, label: `${first.count} ${noun(first.count)} in this file, in ${counts.map(({ project }) => project).join(', ')}` };
  }
  return { tests: inFile, label: `failed tests in this file: ${counts.map(({ project, count }) => `${count} in ${project}`).join(', ')}` };
}

/** Help text of every rerun button. */
export const RERUN_HELP =
  'For a POSIX shell (bash, zsh), run from the Playwright root directory: paths are relative to it. A file:line argument targets the line where the test is declared, and reruns every test declared on that line. The command is only valid while the file has not changed since the run.';
