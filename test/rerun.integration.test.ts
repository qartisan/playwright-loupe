import { mkdtempSync, rmSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rerunCommand } from '../src/renderer/detail/rerun.js';
import { REDACTED } from '../src/shared/redaction.js';
import type { LoupeReport, TestCase } from '../src/schema/v1.js';
import { REWRITTEN_DECOY, REWRITTEN_TITLES, expectedFor, keyOf } from '../fixtures/helpers/rerun-expected.js';
import { FIXTURE_SECRET } from '../fixtures/redaction-values.js';
import { FIXTURE_CONFIG, RERUN_CONFIG, ROOT, assertBuilt, pasteInShell, playwright, readReport } from './helpers/fixtures.js';

/**
 * The rerun commands against the installed Playwright: each one, as pasted in
 * a shell, with `--list`, selects exactly its tests, whatever line the report
 * records. Reports come from `--list` too: nothing runs, no browser is needed.
 * In every CI job and the weekly one, so a change in what `-g` matches shows.
 */

const SELECTION_REPORTER = path.join(ROOT, 'fixtures/helpers/selection-reporter.ts');

/** Runs at once: each command starts a Playwright, mostly waiting for the disk. */
const CONCURRENCY = Math.min(4, availableParallelism());

type Key = string;

type Shift = (test: TestCase, report: LoupeReport) => number;

/** The line of the next test of its file: each command would select that one, were the line used. */
function lineOfNextTest(test: TestCase, report: LoupeReport): number {
  const lines = [...new Set(report.tests.filter((other) => other.file === test.file).map((other) => other.line))].sort((a, b) => a - b);
  return lines[(lines.indexOf(test.line) + 1) % lines.length] ?? test.line;
}

/** Projects other projects depend on, in the fixtures. */
const DEPENDENCIES = new Set(['setup']);

const SHIFTS: readonly (readonly [string, Shift])[] = [
  ['as recorded', (test) => test.line],
  ['one line down', (test) => test.line + 1],
  ['17 lines down', (test) => test.line + 17],
  ['far past the end of the file', (test) => test.line + 100_000],
  ['on the next test of the file', lineOfNextTest],
];

function shifted(report: LoupeReport, shift: Shift): LoupeReport {
  return { ...report, tests: report.tests.map((test) => ({ ...test, line: shift(test, report) })) };
}

function groupedBy(tests: readonly TestCase[], key: (test: TestCase) => string): TestCase[][] {
  const groups = new Map<string, TestCase[]>();
  for (const test of tests) groups.set(key(test), [...(groups.get(key(test)) ?? []), test]);
  return [...groups.values()];
}

describe('rerun commands against the installed Playwright', () => {
  let workDir: string;
  /** Each distinct command runs once: the same text selects the same tests, and text depending on the line runs apart. */
  const selections = new Map<string, Promise<Key[]>>();
  const reports = new Map<string, LoupeReport>();

  function report(config: string): LoupeReport {
    const known = reports.get(config);
    if (known) return known;
    const outputFolder = path.join(workDir, path.basename(config));
    const result = playwright(['test', '--list', '--config', config], { LOUPE_FIXTURE_OUTPUT: outputFolder });
    const read = readReport(outputFolder, `Exit code ${result.status}.\n${result.output}`);
    reports.set(config, read);
    return read;
  }

  async function select(command: string, config: string): Promise<Key[]> {
    const { status, output } = await pasteInShell(`${command} --list --config ${config} --reporter "${SELECTION_REPORTER}"`);
    const line = output.split('\n').find((candidate) => candidate.startsWith('LOUPE_SELECTION '));
    if (!line) throw new Error(`No selection from: ${command}\nExit code ${status}.\n${output}`);
    return (JSON.parse(line.slice('LOUPE_SELECTION '.length)) as string[][]).map((parts) => JSON.stringify(parts));
  }

  function selection(command: string, config: string): Promise<Key[]> {
    const key = `${config}\0${command}`;
    let known = selections.get(key);
    if (!known) {
      known = select(command, config);
      selections.set(key, known);
    }
    return known;
  }

  /** Runs the command of each check, CONCURRENCY at once. Returns those selecting anything else than expected. */
  async function failures(checks: readonly { tests: readonly TestCase[]; expected: readonly Key[] }[], config: string): Promise<unknown[]> {
    const queue = [...checks];
    const failed: unknown[] = [];
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        for (let check = queue.shift(); check; check = queue.shift()) {
          const command = rerunCommand(check.tests);
          const asked = new Set(check.tests.map((test) => test.project));
          // A dependency project selected for a project asked: checked apart below.
          const selected = (await selection(command, config)).filter((key) => asked.has(JSON.parse(key)[0] as string) || !DEPENDENCIES.has(JSON.parse(key)[0] as string));
          const missing = check.expected.filter((key) => !selected.includes(key));
          const extra = selected.filter((key) => !check.expected.includes(key));
          if (missing.length > 0 || extra.length > 0) failed.push({ command, missing, extra });
        }
      }),
    );
    return failed;
  }

  const one = (test: TestCase): { tests: TestCase[]; expected: Key[] } => ({ tests: [test], expected: expectedFor(test) });
  const many = (tests: readonly TestCase[]): { tests: readonly TestCase[]; expected: Key[] } => ({ tests, expected: tests.flatMap(expectedFor) });

  beforeAll(() => {
    assertBuilt();
    workDir = mkdtempSync(path.join(tmpdir(), 'loupe-rerun-'));
  });

  afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  describe.each([
    ['the rerun fixture', RERUN_CONFIG],
    ['the main fixture', FIXTURE_CONFIG],
  ])('%s', (_name, config) => {
    it.each(SHIFTS)('selects exactly each test, lines %s', async (_shift, shift) => {
      const { tests } = shifted(report(config), shift);
      expect(tests.length).toBeGreaterThan(0);
      expect(await failures(tests.map(one), config)).toEqual([]);
    }, 300_000);

    it.each(SHIFTS)('selects exactly the tests of a list, lines %s', async (_shift, shift) => {
      const { tests } = shifted(report(config), shift);
      const lists = [tests, ...groupedBy(tests, (test) => test.project), ...groupedBy(tests, (test) => test.file)];
      expect(await failures(lists.map(many), config)).toEqual([]);
    }, 300_000);
  });

  it('lands on another test with the shift the commands must resist, as the form with a line shows', async () => {
    const original = report(RERUN_CONFIG);
    const inPlain = (title: string): TestCase => {
      const test = original.tests.find((candidate) => candidate.project === 'main' && candidate.file === 'plain.spec.ts' && candidate.title === title);
      if (!test) throw new Error(`No test "${title}" in plain.spec.ts`);
      return test;
    };
    const line = lineOfNextTest(inPlain('alpha'), original);
    expect(line).toBe(inPlain('beta').line);
    // With this line, the file:line form would rerun `beta`, not `alpha` (and whatever sits on that line in files with a similar name).
    const selected = await selection(`npx playwright test plain.spec.ts:${line} --project=main`, RERUN_CONFIG);
    expect(selected).toContain(keyOf(inPlain('beta')));
    expect(selected).not.toContain(keyOf(inPlain('alpha')));
  }, 120_000);

  it('never selects by line: the commands of a shifted report are the same text', () => {
    for (const config of [RERUN_CONFIG, FIXTURE_CONFIG]) {
      const original = report(config).tests;
      for (const [, shift] of SHIFTS) {
        const { tests } = shifted(report(config), shift);
        expect(tests.map((test) => rerunCommand([test]))).toEqual(original.map((test) => rerunCommand([test])));
        expect(rerunCommand(tests)).toBe(rerunCommand(original));
      }
    }
  }, 120_000);

  describe('with the rerun fixture', () => {
    const inFile = (project: string, file: string, title: string): TestCase => {
      const test = report(RERUN_CONFIG).tests.find((candidate) => candidate.project === project && candidate.file === file && candidate.title === title);
      if (!test) throw new Error(`No test "${title}" in ${file} of ${project}`);
      return test;
    };

    it('does not select the other tests of the flags and files, when projects have different tests', async () => {
      const tests = [inFile('main', 'plain.spec.ts', 'alpha'), inFile('other', 'plain.spec.ts', 'beta')];
      expect(await failures([many(tests)], RERUN_CONFIG)).toEqual([]);
      const selected = await selection(rerunCommand(tests), RERUN_CONFIG);
      expect(selected).not.toContain(keyOf(inFile('main', 'plain.spec.ts', 'beta')));
      expect(selected).not.toContain(keyOf(inFile('other', 'plain.spec.ts', 'alpha')));
    }, 120_000);

    it('runs the dependencies of a project, never adding --no-deps', async () => {
      const command = rerunCommand([inFile('main', 'plain.spec.ts', 'alpha')]);
      expect(command).not.toContain('--no-deps');
      const selected = (await selection(command, RERUN_CONFIG)).map((key) => JSON.parse(key) as string[]);
      expect(selected.map(([project]) => project)).toEqual(expect.arrayContaining(['setup', 'main']));
    }, 120_000);

    it('selects a test of an unnamed project without --project', async () => {
      const unnamed = inFile('', 'plain.spec.ts', 'alpha');
      expect(rerunCommand([unnamed])).not.toContain('--project');
      expect(await selection(rerunCommand([unnamed]), RERUN_CONFIG)).toEqual([keyOf(unnamed)]);
    }, 120_000);

    it('reruns a test whose title the report hides a secret in, the secret nowhere in the command', async () => {
      const hidden = report(RERUN_CONFIG).tests.filter((candidate) => candidate.file === 'redaction.spec.ts' && candidate.title === `with the secret ${REDACTED}`);
      expect(hidden).toHaveLength(2);
      for (const candidate of report(RERUN_CONFIG).tests) expect(JSON.stringify(candidate)).not.toContain(FIXTURE_SECRET);
      const command = rerunCommand([hidden[0]!]);
      expect(command).toContain('.+');
      expect(command).not.toContain(FIXTURE_SECRET);
      const selected = (await selection(command, RERUN_CONFIG)).map((key) => JSON.parse(key) as string[]).filter(([project]) => project === 'main');
      expect(selected.map((parts) => parts.at(-1)).sort()).toEqual([`with the secret ${FIXTURE_SECRET}`, `with the secret ${REDACTED}`].sort());
    }, 120_000);

    describe('a title holding a path under the root or home directory', () => {
      const inTitles = (): TestCase[] => report(RERUN_CONFIG).tests.filter((test) => test.project === 'main' && test.file === 'paths-in-titles.spec.ts');
      const selectedInMain = async (test: TestCase): Promise<string[]> =>
        (await selection(rerunCommand([test]), RERUN_CONFIG)).map((key) => JSON.parse(key) as string[]).filter(([project]) => project === 'main').map((parts) => parts.at(-1) ?? '');

      it('is rewritten in the report, as these tests assume', () => {
        const titles = inTitles().map((test) => test.title);
        expect(titles).toEqual(expect.arrayContaining([...REWRITTEN_TITLES, REWRITTEN_DECOY]));
        expect(titles.filter((title) => title === REWRITTEN_DECOY)).toHaveLength(2);
        expect(titles.join()).not.toContain(path.join(ROOT, 'fixtures'));
      });

      it.each(REWRITTEN_TITLES)('selects no test: %s', async (title) => {
        const test = inTitles().find((candidate) => candidate.title === title);
        if (!test) throw new Error(`No test "${title}"`);
        expect(await selectedInMain(test)).toEqual([]);
      }, 120_000);

      it('selects another test when one really has the rewritten title', async () => {
        const [test] = inTitles().filter((candidate) => candidate.title === REWRITTEN_DECOY);
        if (!test) throw new Error(`No test "${REWRITTEN_DECOY}"`);
        expect(await selectedInMain(test)).toEqual([REWRITTEN_DECOY]);
      }, 120_000);
    });

    it('escapes the variation selector of a title, and selects the test', async () => {
      const test = inFile('main', 'titles.spec.ts', 'heart ❤\ufe0f with a variation selector');
      expect(rerunCommand([test])).toContain('heart \\u2764\\ufe0f with a variation selector$');
      expect(await selection(rerunCommand([test]), RERUN_CONFIG)).toContain(keyOf(test));
    }, 120_000);

    it('selects a test of a project off by default through --project', async () => {
      // Plain `--list` leaves that project out from Playwright 1.64: it is not in the report, the command is.
      const test = { ...inFile('main', 'plain.spec.ts', 'alpha'), project: 'off-by-default' };
      expect(await selection(rerunCommand([test]), RERUN_CONFIG)).toEqual([keyOf(test)]);
    }, 120_000);
  });
});
