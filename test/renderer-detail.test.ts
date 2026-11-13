import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { errorGroups } from '../src/renderer/dashboard.js';
import { buildAiPrompt } from '../src/renderer/detail/aiPrompt.js';
import { attemptLabel, defaultAttempt, selectAttempt } from '../src/renderer/detail/attempts.js';
import { joinQuery, parseDetailParams, serializeDetailParams } from '../src/renderer/detail/params.js';
import { LINUX_COMMAND_BYTES, WINDOWS_LINE_LENGTH, windowsLineLength, commandLimit, commandNotice, failedTests, failedTestsInFile, fileRerun, rerunCommand, shellQuote, type RerunTarget } from '../src/renderer/detail/rerun.js';
import { groupNavigation, groupSequence, neighbors, testSequence } from '../src/renderer/detail/sequence.js';
import { failingPath, failingStepContext, stepTree, type StepNode } from '../src/renderer/detail/steps.js';
import { NO_FILTER_CONTEXT } from '../src/renderer/filters/match.js';
import { buildSortRanks } from '../src/renderer/filters/sort.js';
import { parseFilters } from '../src/renderer/filters/url.js';
import { REDACTED } from '../src/shared/redaction.js';
import type { Attempt, AttemptStatus, LoupeError, Step, TestCase } from '../src/schema/v1.js';

let nextId = 1;

function error(message: string, fields: Partial<LoupeError> = {}): LoupeError {
  return { message, stack: null, location: null, snippet: null, signature: message, category: 'Assertion', ...fields };
}

function attempt(index: number, status: AttemptStatus, fields: Partial<Attempt> = {}): Attempt {
  return {
    index,
    status,
    startedAt: '2026-10-16T00:00:00.000Z',
    durationMs: 100,
    workerIndex: 0,
    errors: status === 'passed' || status === 'skipped' ? [] : [error(`failure ${index}`)],
    steps: [],
    attachments: [],
    annotations: [],
    stdout: { text: '', truncated: false },
    stderr: { text: '', truncated: false },
    ...fields,
  };
}

function makeTest(fields: Partial<TestCase> = {}): TestCase {
  const id = String(nextId++).padStart(16, '0');
  return {
    id,
    repeatEachIndex: 0,
    project: 'chromium',
    file: 'a.spec.ts',
    line: 1,
    column: 1,
    suitePath: [],
    title: `test ${id}`,
    tags: [],
    annotations: [],
    outcome: 'passed',
    expectedStatus: 'passed',
    durationMs: 100,
    dimensions: {},
    category: null,
    errorSignature: null,
    attempts: [attempt(0, 'passed')],
    ...fields,
  };
}

function step(title: string, category: string, fields: Partial<Step> = {}): Step {
  return { title, subtitle: null, category, durationMs: 10, error: null, location: null, steps: [], ...fields };
}

describe('attempts', () => {
  it('labels the first run and the retries', () => {
    expect([0, 1, 2].map(attemptLabel)).toEqual(['Attempt 1', 'Retry 1', 'Retry 2']);
  });

  it('shows the last attempt of a failed test', () => {
    const test = makeTest({ outcome: 'failed', attempts: [attempt(0, 'failed'), attempt(1, 'timedOut')] });
    expect(defaultAttempt(test)?.index).toBe(1);
  });

  it('shows the failing attempt of a flaky test, not the passing retry', () => {
    const test = makeTest({ outcome: 'flaky', attempts: [attempt(0, 'failed'), attempt(1, 'passed')] });
    expect(defaultAttempt(test)?.index).toBe(0);
  });

  it('shows the last failing attempt when several failed before a pass', () => {
    const test = makeTest({ outcome: 'flaky', attempts: [attempt(0, 'failed'), attempt(1, 'failed'), attempt(2, 'passed')] });
    expect(defaultAttempt(test)?.index).toBe(1);
  });

  it('shows the only attempt of a passed or skipped test', () => {
    expect(defaultAttempt(makeTest())?.index).toBe(0);
    expect(defaultAttempt(makeTest({ outcome: 'skipped', expectedStatus: 'skipped', attempts: [attempt(0, 'skipped')] }))?.index).toBe(0);
  });

  it('shows the last attempt of an expected failure (test.fail), which did not fail unexpectedly', () => {
    const test = makeTest({ expectedStatus: 'failed', attempts: [attempt(0, 'failed')] });
    expect(defaultAttempt(test)?.index).toBe(0);
  });

  it('has no attempt to show for a test without attempts', () => {
    expect(defaultAttempt(makeTest({ attempts: [] }))).toBeNull();
  });

  it('selects the requested attempt, or falls back to the default one when it does not exist', () => {
    const test = makeTest({ outcome: 'flaky', attempts: [attempt(0, 'failed'), attempt(1, 'passed')] });
    expect(selectAttempt(test, 1)).toEqual({ attempt: test.attempts[1], valid: true });
    expect(selectAttempt(test, null)).toEqual({ attempt: test.attempts[0], valid: true });
    expect(selectAttempt(test, 5)).toEqual({ attempt: test.attempts[0], valid: false });
  });
});

describe('detail URL parameters', () => {
  it('reads the attempt index and the steps mode, ignoring malformed values', () => {
    expect(parseDetailParams('status=failed&attempt=2&steps=all')).toEqual({ attempt: 2, allSteps: true });
    expect(parseDetailParams('attempt=01&steps=some')).toEqual({ attempt: null, allSteps: false });
    expect(parseDetailParams('attempt=-1')).toEqual({ attempt: null, allSteps: false });
    expect(parseDetailParams('')).toEqual({ attempt: null, allSteps: false });
  });

  it('writes a canonical form, empty at the defaults', () => {
    expect(serializeDetailParams({ attempt: 0, allSteps: true })).toBe('attempt=0&steps=all');
    expect(serializeDetailParams({ attempt: null, allSteps: false })).toBe('');
    expect(joinQuery('status=failed', '', 'attempt=1')).toBe('status=failed&attempt=1');
  });
});

describe('steps', () => {
  // As Playwright reports a failure in a nested test.step: the error is on the expect and on each enclosing step.
  const failure = error('Error: expect(locator).toHaveText(expected) failed');
  const steps: Step[] = [
    step('Before Hooks', 'hook', { steps: [step('Fixture "page"', 'fixture', { steps: [step('Create page', 'pw:api')] })] }),
    step('open the cart', 'test.step', {
      error: failure,
      steps: [
        step('Set content', 'pw:api'),
        step('check the total', 'test.step', {
          error: failure,
          steps: [step('Expect "toHaveText"', 'expect', { error: failure })],
        }),
      ],
    }),
    step('After Hooks', 'hook', { steps: [step('Fixture "page"', 'fixture')] }),
  ];

  function shape(nodes: readonly StepNode[]): unknown[] {
    return nodes.map((node) => (node.children.length > 0 ? [node.step.title, shape(node.children)] : node.step.title));
  }

  it('finds the failing path, down to the deepest failing step', () => {
    expect(failingPath(steps)).toEqual(['1', '1.1', '1.1.0']);
    expect(failingPath([step('a', 'test.step')])).toEqual([]);
  });

  it('shows test.step steps and failing steps by default, hiding hooks, fixtures and API calls', () => {
    expect(shape(stepTree(steps, 'default'))).toEqual([['open the cart', [['check the total', ['Expect "toHaveText"']]]]]);
  });

  it('keeps the ancestors needed to place a visible step', () => {
    const inHook = [
      step('Before Hooks', 'hook', {
        steps: [step('beforeEach hook', 'hook', { steps: [step('Navigate to "/"', 'pw:api', { error: error('page.goto failed') })] })],
      }),
      step('Click', 'pw:api'),
    ];
    expect(shape(stepTree(inHook, 'default'))).toEqual([['Before Hooks', [['beforeEach hook', ['Navigate to "/"']]]]]);
  });

  it('shows every step in "all" mode', () => {
    expect(shape(stepTree(steps, 'all'))).toEqual([
      ['Before Hooks', [['Fixture "page"', ['Create page']]]],
      ['open the cart', ['Set content', ['check the total', ['Expect "toHaveText"']]]],
      ['After Hooks', ['Fixture "page"']],
    ]);
  });

  it('marks the failing path and the failing step with the same keys in both modes', () => {
    for (const mode of ['default', 'all'] as const) {
      const flat = (nodes: readonly StepNode[]): StepNode[] => nodes.flatMap((node) => [node, ...flat(node.children)]);
      const nodes = flat(stepTree(steps, mode));
      expect(nodes.filter((node) => node.onFailingPath).map((node) => node.key)).toEqual(['1', '1.1', '1.1.0']);
      expect(nodes.filter((node) => node.failing).map((node) => node.step.title)).toEqual(['Expect "toHaveText"']);
    }
  });

  it('gives the failing step with up to 5 preceding steps at its level', () => {
    const many = [
      ...Array.from({ length: 7 }, (_, index) => step(`step ${index}`, 'pw:api')),
      step('Click', 'pw:api', { error: error('click failed') }),
      step('after', 'pw:api'),
    ];
    const context = failingStepContext(many);
    expect(context?.path.map((item) => item.title)).toEqual(['Click']);
    expect(context?.preceding.map((item) => item.title)).toEqual(['step 2', 'step 3', 'step 4', 'step 5', 'step 6']);
    expect(failingStepContext(steps)?.preceding).toEqual([]);
    expect(failingStepContext([step('ok', 'test.step')])).toBeNull();
  });
});

describe('rerun commands', () => {
  const target = (title: string, fields: Partial<RerunTarget> = {}): RerunTarget => ({ file: 'a.spec.ts', project: 'chromium', suitePath: [], tags: [], title, ...fields });
  const grepOf = (command: string): string => command.match(/ -g "(.*)"$/)?.[1] ?? '';
  /** As Playwright reads `-g`: a regular expression with the `gi` flags, tested on the string of a test. */
  const selects = (tests: readonly RerunTarget[], grepString: string): boolean => new RegExp(grepOf(rerunCommand(tests)), 'gi').test(grepString);

  it('reruns one test by file, project and title, with no line', () => {
    expect(rerunCommand([target('logs in', { file: 'tests/login.spec.ts' })])).toBe(
      'npx playwright test tests.login.spec.ts --project=chromium -g "^ *chromium tests.login.spec.ts logs in$"',
    );
  });

  it('gives the same command whatever the line of the test', () => {
    const test = makeTest({ line: 12 });
    expect(rerunCommand([makeTest({ ...test, line: 4021 })])).toBe(rerunCommand([test]));
  });

  it('leaves out --project for an unnamed project, whose string starts with a space', () => {
    const command = rerunCommand([target('alpha', { file: 'u.spec.ts', project: '' })]);
    expect(command).toBe('npx playwright test u.spec.ts -g "^ *u.spec.ts alpha$"');
    expect(selects([target('alpha', { file: 'u.spec.ts', project: '' })], ' u.spec.ts alpha')).toBe(true);
  });

  it('reruns only the test itself in a multi-project run, not its twin in the other project', () => {
    const tests = [makeTest({ project: 'chromium-a', title: 't' }), makeTest({ project: 'chromium-b', title: 't' })];
    expect(rerunCommand([tests[0]!])).toBe('npx playwright test a.spec.ts --project=chromium-a -g "^ *chromium-a a.spec.ts t$"');
  });

  // The strings are those Playwright 1.52 to 1.64 match; the integration test checks them against the installed version.
  it.each<[string, RerunTarget, string, string[]]>([
    ['nested describes', target('same', { suitePath: ['outer', 'inner'] }), 'chromium a.spec.ts outer inner same', ['chromium a.spec.ts outer same', 'chromium a.spec.ts other inner same']],
    ['a title that is a prefix of another', target('login'), 'chromium a.spec.ts login', ['chromium a.spec.ts login twice']],
    ['a title that is a suffix of another', target('login'), 'chromium a.spec.ts login', ['chromium a.spec.ts first login']],
    ['the same title in two describes', target('same', { suitePath: ['a'] }), 'chromium a.spec.ts a same', ['chromium a.spec.ts b same']],
    ['the same title in two files', target('same'), 'chromium a.spec.ts same', ['chromium b.spec.ts same', 'chromium sub/a.spec.ts same', 'chromium aa.spec.ts same']],
    ['the same title in two projects', target('same'), 'chromium a.spec.ts same', ['firefox a.spec.ts same']],
    ['titles built in a loop', target('param 1'), 'chromium a.spec.ts param 1', ['chromium a.spec.ts param 10', 'chromium a.spec.ts param 2']],
    ['a separator on Windows', target('t', { file: 'tests/sub/a.spec.ts' }), 'chromium tests\\sub\\a.spec.ts t', ['chromium tests\\sub\\b.spec.ts t']],
    ['a tag in the title', target('adds @layer:api', { tags: ['@layer:api'] }), 'chromium a.spec.ts adds @layer:api', ['chromium a.spec.ts adds @layer:api more', 'chromium a.spec.ts adds']],
    ['a tag from test({ tag })', target('t', { tags: ['@a', '@b:c'] }), 'chromium a.spec.ts t @a @b:c', ['chromium a.spec.ts t2 @a', 'chromium a.spec.ts t more']],
    ['a tag from describe({ tag })', target('t', { suitePath: ['s'], tags: ['@d'] }), 'chromium a.spec.ts s @d t', ['chromium a.spec.ts s t2 @d', 'chromium a.spec.ts x @d t']],
    ['tags from nested describes, the test and the title', target('z @inline', { suitePath: ['a', 'b'], tags: ['@1', '@2', '@inline', '@3'] }), 'chromium a.spec.ts a @1 b @2 z @inline @3', ['chromium a.spec.ts a @1 b @2 y @3']],
    ['a tag from a describe without a title', target('t', { tags: ['@e'] }), 'chromium a.spec.ts @e t', ['chromium a.spec.ts @e t2']],
    ['a tag both in the title and in { tag }', target('dup @x', { tags: ['@x', '@x'] }), 'chromium a.spec.ts dup @x @x', ['chromium a.spec.ts dup @x more']],
    ['a word with @ in the title', target('foo@bar', { tags: ['@bar'] }), 'chromium a.spec.ts foo@bar', ['chromium a.spec.ts foo@bar2']],
    ['regex metacharacters', target('regex .*+?^$()[]{}|\\ all'), 'chromium a.spec.ts regex .*+?^$()[]{}|\\ all', ['chromium a.spec.ts regex xxxxxxx^$()[]{}|\\ all']],
    ['quotes', target(`double "q" single 'q'`), `chromium a.spec.ts double "q" single 'q'`, []],
    ['shell expansions', target('$HOME $(id) ${x} `id` %PATH% !! end$'), 'chromium a.spec.ts $HOME $(id) ${x} `id` %PATH% !! end$', []],
    ['comparison signs', target('value >= 10'), 'chromium a.spec.ts value >= 10', ['chromium a.spec.ts value <= 10']],
    ['symbols of the same length', target('price €10'), 'chromium a.spec.ts price €10', ['chromium a.spec.ts price $10']],
    ['a slash and a backslash', target('a/b\\c'), 'chromium a.spec.ts a/b\\c', []],
    ['accented letters', target('accents éàü'), 'chromium a.spec.ts accents éàü', ['chromium a.spec.ts accents eau']],
    ['CJK letters', target('日本語のタイトル'), 'chromium a.spec.ts 日本語のタイトル', ['chromium a.spec.ts 日本語のテスト名']],
    ['an emoji', target('emoji 🚀 ok'), 'chromium a.spec.ts emoji 🚀 ok', ['chromium a.spec.ts emoji 🎉 ok']],
    ['a joined emoji', target('👩‍💻'), 'chromium a.spec.ts 👩‍💻', ['chromium a.spec.ts 👩']],
    ['a tab and a line break', target('a\tb\nc'), 'chromium a.spec.ts a\tb\nc', []],
    ['spaces at the end and in a row', target('a  b '), 'chromium a.spec.ts a  b ', ['chromium a.spec.ts a b', 'chromium a.spec.ts a  b']],
    ['a leading dash', target('-x'), 'chromium a.spec.ts -x', []],
    ['a very long title', target(`L${'o'.repeat(1500)}ng`), `chromium a.spec.ts L${'o'.repeat(1500)}ng`, [`chromium a.spec.ts L${'o'.repeat(1500)}ng2`]],
    ['a project name with metacharacters', target('t', { project: 'mobile (iOS) + $x' }), 'mobile (iOS) + $x a.spec.ts t', ['mobile a.spec.ts t']],
    ['a non-ASCII project name', target('t', { project: 'été' }), 'été a.spec.ts t', ['ete a.spec.ts t']],
  ])('selects exactly the test with %s', (_case, test, itself, others) => {
    expect(selects([test], itself)).toBe(true);
    for (const other of others) expect(selects([test], other)).toBe(false);
  });

  it.each<[string, RerunTarget, string, string[]]>([
    ['in a title', target(`with the secret ${REDACTED}`), 'chromium a.spec.ts with the secret s3cret value', ['chromium a.spec.ts with the secret', 'chromium a.spec.ts other s3cret']],
    ['at the start of a title, twice', target(`${REDACTED} then ${REDACTED}`), 'chromium a.spec.ts s3 then cr3t', ['chromium a.spec.ts then cr3t', 'chromium a.spec.ts s3 then ']],
    ['in a describe', target('leaf', { suitePath: [`in ${REDACTED} here`] }), 'chromium a.spec.ts in s3 here leaf', ['chromium a.spec.ts in here leaf']],
    ['in a file', target('t', { file: `tests/${REDACTED}/a.spec.ts` }), 'chromium tests/s3/a.spec.ts t', ['chromium tests/a.spec.ts t']],
    ['in a project', target('t', { project: `p-${REDACTED}` }), 'p-s3 a.spec.ts t', ['p- a.spec.ts t']],
    ['with { tag } tags', target(`x ${REDACTED}`, { tags: ['@a'] }), 'chromium a.spec.ts x s3 @a', ['chromium a.spec.ts y s3 @a']],
  ])('stands for a redacted secret with .+, %s', (_case, test, itself, others) => {
    expect(rerunCommand([test])).not.toContain(REDACTED);
    expect(selects([test], itself)).toBe(true);
    for (const other of others) expect(selects([test], other)).toBe(false);
  });

  it('runs a title really containing the marker with those it then matches, a harmless twin', () => {
    const test = target(`with the secret ${REDACTED}`);
    expect(grepOf(rerunCommand([test]))).toBe('^ *chromium a.spec.ts with the secret .+$');
    expect(selects([test], `chromium a.spec.ts with the secret ${REDACTED}`)).toBe(true);
  });

  it('gives --project a wildcard for a redacted secret, and -g the exact project', () => {
    expect(rerunCommand([target('t', { project: `p-${REDACTED}` })])).toContain('"--project=p-*" -g "^ *p-.+ a.spec.ts t$"');
  });

  it.each<[string, RerunTarget, string, string[]]>([
    ['in a title', target('reads ~/other/a.json'), 'chromium a.spec.ts reads /home/me/other/a.json', ['chromium a.spec.ts reads /other/a.json', 'chromium a.spec.ts reads /home/me/other/b.json']],
    ['in a Windows title', target('reads ~\\app\\b.json'), 'chromium a.spec.ts reads C:\\Users\\me\\app\\b.json', ['chromium a.spec.ts reads C:/Users/me/app/b.json']],
    ['twice in a title', target('list ~/a:~/b'), 'chromium a.spec.ts list /home/me/a:/home/me/b', ['chromium a.spec.ts list /home/me/a:b']],
    ['in a describe', target('leaf', { suitePath: ['in ~/s'] }), 'chromium a.spec.ts in /home/me/s leaf', ['chromium a.spec.ts in s leaf']],
    ['in a project', target('t', { project: '~/proj' }), '/home/me/proj a.spec.ts t', ['proj a.spec.ts t']],
    ['with { tag } tags', target('x ~/y', { tags: ['@a'] }), 'chromium a.spec.ts x /home/me/y @a', ['chromium a.spec.ts z /home/me/y @a']],
  ])('stands for a home directory with .+, %s', (_case, test, itself, others) => {
    expect(rerunCommand([test])).not.toContain('~');
    expect(selects([test], itself)).toBe(true);
    for (const other of others) expect(selects([test], other)).toBe(false);
  });

  it('reads a title really containing `~` the same way, with the neighbours it then matches', () => {
    const test = target('about ~ 5 items');
    expect(grepOf(rerunCommand([test]))).toBe('^ *chromium a.spec.ts about .+ 5 items$');
    expect(selects([test], 'chromium a.spec.ts about ~ 5 items')).toBe(true);
    expect(selects([test], 'chromium a.spec.ts about roughly 5 items')).toBe(true);
  });

  it('reads `~` and the redaction marker alike in one title', () => {
    const test = target(`reads ~/x as ${REDACTED}`);
    expect(grepOf(rerunCommand([test]))).toBe('^ *chromium a.spec.ts reads .+\\x2fx as .+$');
    expect(selects([test], 'chromium a.spec.ts reads /home/me/x as s3cret')).toBe(true);
  });

  it('keeps `~` literal in a file', () => {
    const test = target('t', { file: 'a~b.spec.ts' });
    expect(rerunCommand([test])).toBe('npx playwright test "a~b.spec.ts" --project=chromium -g "^ *chromium a~b.spec.ts t$"');
    expect(selects([test], 'chromium axb.spec.ts t')).toBe(false);
  });

  it('writes once a prefix holding `~`, shared by several tests', () => {
    const tests = [target('a', { suitePath: ['in ~/s'] }), target('b', { suitePath: ['in ~/s'] })];
    expect(grepOf(rerunCommand(tests))).toBe('^ *chromium a.spec.ts in .+\\x2fs (a|b)$');
    expect(selects(tests, 'chromium a.spec.ts in /home/me/s b')).toBe(true);
  });

  it('gives --project a wildcard for `~` and `/`, and -g the exact project', () => {
    expect(rerunCommand([target('t', { project: 'p ~ x' })])).toContain('"--project=p * x" -g "^ *p .+ x a.spec.ts t$"');
    expect(rerunCommand([target('t', { project: '~/proj' })])).toContain('"--project=**proj" -g "^ *.+\\x2fproj a.spec.ts t$"');
    expect(rerunCommand([target('t', { project: '/opt/proj' })])).toContain('"--project=*opt*proj" -g "^ *\\x2fopt\\x2fproj a.spec.ts t$"');
  });

  it('computes the Windows line of a command holding `~`, which adds no character to escape', () => {
    const line = (title: string): number => windowsLineLength(rerunCommand([target(title)]));
    expect(line('a ~ b')).toBe(line('a xx b'));
    const long = Array.from({ length: 40 }, (_, index) => target(`${'word ~ '.repeat(30)}${index}`));
    expect(windowsLineLength(rerunCommand(long))).toBeGreaterThan(WINDOWS_LINE_LENGTH);
    expect(commandLimit(rerunCommand(long))).toBe('windows');
  });

  it('ignores case and cannot separate the tests with the same string, which run together', () => {
    expect(selects([target('Login')], 'chromium a.spec.ts login')).toBe(true);
    expect(selects([target('same', { suitePath: ['outer'] })], 'chromium a.spec.ts outer same')).toBe(true);
    expect(selects([target('outer same')], 'chromium a.spec.ts outer same')).toBe(true);
    expect(selects([target('tail @smoke', { tags: ['@smoke'] })], 'chromium a.spec.ts tail @smoke')).toBe(true);
    expect(selects([target('tail', { tags: ['@smoke'] })], 'chromium a.spec.ts tail @smoke')).toBe(true);
  });

  it('never uses the /.../ form, which Git Bash rewrites as a path', () => {
    expect(grepOf(rerunCommand([target('t')])).startsWith('^')).toBe(true);
  });

  it.each<[string, RerunTarget]>([
    ['every ASCII character', target(Array.from({ length: 95 }, (_, index) => String.fromCharCode(32 + index)).join(''), { suitePath: ['"$`%!\\^&|<>'], tags: ['@a'] })],
    ['non-ASCII text', target('é 日本 🚀 — ’', { suitePath: ['«s»'] })],
    ['a difficult path', target('t', { file: 'tests/[id]/(g)/a+b c$%é`!"&.spec.ts' })],
    ['a difficult project', target('t', { project: `Gilles's "$x" %y% \`z\` é!^&|<>\\ 🚀` })],
  ])('gives a command no shell acts on, for %s', (_case, test) => {
    const command = rerunCommand([test, target('other', { file: test.file, project: test.project })]);
    expect(command).toMatch(/^[\x20-\x7e\p{L}\p{M}]+$/u);
    const quoted = [...command.matchAll(/"([^"]*)"/g)].map((match) => match[1] ?? '');
    expect(quoted.join('')).not.toMatch(/[`%!&<>]/);
    const grep = grepOf(command);
    // Each `$`, `^`, `|`... is the regular expression's: anchors at the ends, alternation in between.
    expect(grep.slice(1, -1)).not.toMatch(/[$^]/);
    expect(grep.at(-1)).toBe('$');
    expect(quoted.slice(0, -1).join('')).not.toMatch(/[$^|]/);
    // A backslash never comes before what POSIX double quotes unescape, nor before a closing quote.
    for (const value of quoted) {
      expect(value).not.toMatch(/\\[$`"\\\n]/);
      expect(value).not.toMatch(/\\$/);
    }
    // Outside the double quotes: nothing but plain words, so no glob, no expansion.
    expect(command.replace(/"[^"]*"/g, '')).toMatch(/^[\w. =-]*$/);
  });

  it.each<[string, string, string]>([
    ['accented letters', 'é à ü ñ Ç', 'é à ü ñ Ç'],
    ['CJK letters', '日本語', '日本語'],
    ['a letter outside the BMP', '𝒜', '𝒜'],
    ['a decomposed letter: its combining mark', 'e\u0301', 'e\u0301'],
    ['marks of an Indic script', 'हिन्दी', 'हिन्दी'],
  ])('leaves %s literal', (_case, title, expected) => {
    expect(grepOf(rerunCommand([target(title)]))).toBe(`^ *chromium a.spec.ts ${expected}$`);
  });

  it.each<[string, string, string]>([
    ['an emoji', '🚀', '\\ud83d\\ude80'],
    ['a joiner', '\u200d', '\\u200d'],
    ['an emoji with a variation selector, a mark but invisible', '❤\ufe0f', '\\u2764\\ufe0f'],
    ['a text variation selector', 'x\ufe0e', 'x\\ufe0e'],
    ['a variation selector outside the BMP', 'x\u{e0100}', 'x\\udb40\\udd00'],
    ['the last variation selector outside the BMP', 'x\u{e01ef}', 'x\\udb40\\uddef'],
    ['a combining grapheme joiner, a mark but invisible', 'a\u034fb', 'a\\u034fb'],
    ['a Hangul filler, a letter but invisible', '\u3164', '\\u3164'],
    ['dashes', '— –', '\\u2014 \\u2013'],
    ['curly quotes, which PowerShell reads as quotes', '“ ” ‘ ’', '\\u201c \\u201d \\u2018 \\u2019'],
    ['symbols', '€ £ ©', '\\u20ac \\u00a3 \\u00a9'],
    ['a non-breaking space', '\u00a0', '\\u00a0'],
    ['a lone surrogate', '\ud83d', '\\ud83d'],
  ])('escapes %s by UTF-16 code unit', (_case, title, expected) => {
    expect(grepOf(rerunCommand([target(title)]))).toBe(`^ *chromium a.spec.ts ${expected}$`);
  });

  it('selects a title with a variation selector, none left in the command', () => {
    const test = target('heart ❤\ufe0f ok', { suitePath: ['\u{e0100}s'], project: 'p\ufe0f', file: 'f\ufe0f.spec.ts' });
    const command = rerunCommand([test]);
    expect(command).not.toMatch(/\p{Default_Ignorable_Code_Point}/u);
    expect(command).toContain('"--project=p*"');
    expect(selects([test], 'p\ufe0f f\ufe0f.spec.ts \u{e0100}s heart ❤\ufe0f ok')).toBe(true);
    expect(selects([test], 'p f.spec.ts s heart ❤ ok')).toBe(false);
  });

  it('escapes shell characters in hexadecimal, regex metacharacters with a backslash', () => {
    expect(grepOf(rerunCommand([target('$ " ` % ! \\ ^ & | < > /')]))).toBe('^ *chromium a.spec.ts \\x24 \\x22 \\x60 \\x25 \\x21 \\x5c \\x5e \\x26 \\x7c \\x3c \\x3e \\x2f$');
    expect(grepOf(rerunCommand([target('. * + ? ( ) [ ] { }')]))).toBe('^ *chromium a.spec.ts \\. \\* \\+ \\? \\( \\) \\[ \\] \\{ \\}$');
  });

  it('leaves a plain file or project bare, made only of letters, digits, dots, dashes and underscores', () => {
    expect(rerunCommand([target('t', { file: 'tests/my_a-b.spec.ts', project: 'chromium_a-b' })])).toBe(
      'npx playwright test tests.my_a-b.spec.ts --project=chromium_a-b -g "^ *chromium_a-b tests.my_a-b.spec.ts t$"',
    );
  });

  it('quotes a project name with a dot: Windows PowerShell can split an unquoted dashed argument there', () => {
    expect(rerunCommand([target('t', { project: 'v1.2' })])).toBe('npx playwright test a.spec.ts "--project=v1.2" -g "^ *v1\\.2 a.spec.ts t$"');
  });

  it('quotes any other file, with the escaping of -g: it is a regular expression too', () => {
    expect(rerunCommand([target('t', { file: 'tests/[id]/(group)/a+b c.spec.ts' })])).toBe(
      'npx playwright test "tests.\\[id\\].\\(group\\).a\\+b c.spec.ts" --project=chromium -g "^ *chromium tests.\\[id\\].\\(group\\).a\\+b c.spec.ts t$"',
    );
    expect(rerunCommand([target('t', { file: 'tests/[id]/a.spec.ts' })])).toContain('npx playwright test "tests.\\[id\\].a.spec.ts" --project');
    expect(rerunCommand([target('t', { file: 'tests/été.spec.ts' })])).toContain('npx playwright test "tests.été.spec.ts" --project');
    expect(rerunCommand([target('t', { file: 'a $b %c% !d `e` &f.spec.ts' })])).toContain('npx playwright test "a \\x24b \\x25c\\x25 \\x21d \\x60e\\x60 \\x26f.spec.ts" --project');
    expect(rerunCommand([target('t', { file: '-x.spec.ts' })])).toContain('npx playwright test .x.spec.ts --project');
  });

  it('matches the path Playwright tests with the positional file, on any separator', () => {
    const argument = (file: string): RegExp => new RegExp((rerunCommand([target('t', { file })]).match(/^npx playwright test "?(.*?)"? "?--project/)?.[1] ?? '').replace(/^"|"$/g, ''), 'gi');
    expect(argument('tests/[id]/(group)/a+b c.spec.ts').test('/repo/tests/[id]/(group)/a+b c.spec.ts')).toBe(true);
    expect(argument('tests/[id]/(group)/a+b c.spec.ts').test('C:\\repo\\tests\\[id]\\(group)\\a+b c.spec.ts')).toBe(true);
    expect(argument('tests/été.spec.ts').test('/repo/tests/été.spec.ts')).toBe(true);
    expect(argument('tests/été.spec.ts').test('/repo/tests/ete.spec.ts')).toBe(false);
  });

  it('quotes a project name when needed, with * for what a shell could act on: --project takes no regular expression', () => {
    expect(rerunCommand([target('t', { project: 'Mobile Safari' })])).toContain('"--project=Mobile Safari" -g "^ *Mobile Safari a.spec.ts t$"');
    expect(rerunCommand([target('t', { project: 'star*name' })])).toContain('"--project=star*name" -g "^ *star\\*name a.spec.ts t$"');
    expect(rerunCommand([target('t', { project: 'mobile (iOS) + x' })])).toContain('"--project=mobile (iOS) + x" -g');
    expect(rerunCommand([target('t', { project: 'a$b é' })])).toContain('"--project=a*b é" -g "^ *a\\x24b é a.spec.ts t$"');
  });

  it('tolerates tags after each segment only for a test with { tag } tags', () => {
    expect(grepOf(rerunCommand([target('t', { suitePath: ['s'], tags: ['@a'] })]))).toBe('^ *chromium a.spec.ts( @\\S+)* s( @\\S+)* t( @\\S+)*$');
    expect(grepOf(rerunCommand([target('t @a', { suitePath: ['s'], tags: ['@a'] })]))).toBe('^ *chromium a.spec.ts s t @a$');
  });

  it('writes one command for several tests, the same pattern as for one', () => {
    const tests = [target('one'), target('two', { file: 'b.spec.ts' })];
    expect(rerunCommand(tests)).toBe('npx playwright test a.spec.ts b.spec.ts --project=chromium -g "^ *chromium (a.spec.ts one|b.spec.ts two)$"');
    expect(rerunCommand(tests)).not.toContain('&&');
  });

  it('does not share alternatives when the projects failed on different tests: no extra test is selected', () => {
    const tests = [target('one'), target('two', { file: 'b.spec.ts', project: 'firefox' })];
    expect(rerunCommand(tests)).toBe('npx playwright test a.spec.ts b.spec.ts --project=chromium --project=firefox -g "^ *(chromium a.spec.ts one|firefox b.spec.ts two)$"');
    expect(selects(tests, 'chromium a.spec.ts one')).toBe(true);
    expect(selects(tests, 'firefox b.spec.ts two')).toBe(true);
    // The flags and files of the command would allow these two: only -g keeps them out.
    expect(selects(tests, 'firefox a.spec.ts one')).toBe(false);
    expect(selects(tests, 'chromium b.spec.ts two')).toBe(false);
  });

  it('does not share alternatives when one set of tests contains the other', () => {
    const tests = [target('one'), target('two'), target('one', { project: 'firefox' })];
    expect(grepOf(rerunCommand(tests))).toBe('^ *(chromium a.spec.ts (one|two)|firefox a.spec.ts one)$');
    expect(selects(tests, 'chromium a.spec.ts two')).toBe(true);
    expect(selects(tests, 'firefox a.spec.ts two')).toBe(false);
  });

  it('shares alternatives only between the projects with the same tests, a third one apart', () => {
    const tests = [target('one'), target('one', { project: 'firefox' }), target('two', { project: 'webkit' })];
    expect(grepOf(rerunCommand(tests))).toBe('^ *((chromium|firefox) a.spec.ts one|webkit a.spec.ts two)$');
    expect(selects(tests, 'webkit a.spec.ts one')).toBe(false);
    expect(selects(tests, 'chromium a.spec.ts two')).toBe(false);
  });

  it('writes shared prefixes once, a test ending where another goes on included', () => {
    const tests = [target('x', { suitePath: ['s'] }), target('y', { suitePath: ['s'] }), target('s'), target('z', { suitePath: ['s', 't'] })];
    const grep = grepOf(rerunCommand(tests));
    expect(grep).toBe('^ *chromium a.spec.ts (s|s (t z|x|y))$');
    for (const selected of ['s x', 's y', 's', 's t z']) expect(selects(tests, `chromium a.spec.ts ${selected}`)).toBe(true);
    for (const other of ['s t', 's w', 't z', 'x']) expect(selects(tests, `chromium a.spec.ts ${other}`)).toBe(false);
  });

  it('shares the alternatives of projects with the same tests', () => {
    const tests = ['chromium', 'firefox'].flatMap((project) => [target('two', { file: 'b.spec.ts', project }), target('one', { project })]);
    expect(rerunCommand(tests)).toBe('npx playwright test a.spec.ts b.spec.ts --project=chromium --project=firefox -g "^ *(chromium|firefox) (a.spec.ts one|b.spec.ts two)$"');
  });

  it('gives the same command whatever the order of the tests', () => {
    const tests = [target('b'), target('a'), target('c', { file: 'z.spec.ts' }), target('d', { file: 'y.spec.ts' })];
    expect(rerunCommand([...tests].reverse())).toBe(rerunCommand(tests));
  });

  it('counts a test repeated with --repeat-each once', () => {
    expect(rerunCommand([target('t'), target('t')])).toBe(rerunCommand([target('t')]));
  });

  it('selects an unnamed project next to a named one with -g alone: no flag can select it', () => {
    const tests = [target('t', { project: '' }), target('t')];
    expect(rerunCommand(tests)).toBe('npx playwright test a.spec.ts -g "^ *(chromium a.spec.ts t|a.spec.ts t)$"');
    expect(selects(tests, ' a.spec.ts t')).toBe(true);
    expect(selects(tests, 'chromium a.spec.ts t')).toBe(true);
    expect(selects(tests, 'firefox a.spec.ts t')).toBe(false);
  });

  it('is empty for no test', () => {
    expect(rerunCommand([])).toBe('');
  });

  describe('Windows limit', () => {
    /** The commands of the Windows check's measure rows (fixtures/windows-check/long.spec.ts), at their lengths. */
    const inLong = (title: string): RerunTarget => target(title, { file: 'long.spec.ts', project: 'main' });
    const plain = (count: number): string =>
      rerunCommand(Array.from({ length: count }, (_, index) => inLong(`long ${String(index).padStart(2, '0')} ${'x'.repeat(990)}`)));
    const dense = (count: number): string => rerunCommand(Array.from({ length: count }, (_, index) => inLong(`dense ${index} ${'word '.repeat(198)}end`)));

    it.each<[string, () => string, 'windows' | null]>([
      ['dense 3,000', () => dense(3), null],
      ['dense 4,000', () => dense(4), null],
      ['dense 5,000', () => dense(5), null],
      ['dense 6,000', () => dense(6), 'windows'],
      ['dense 7,000', () => dense(7), 'windows'],
      ['dense 8,000', () => dense(8), 'windows'],
      ['plain 7,000', () => plain(7), null],
      ['plain 9,000', () => plain(9), 'windows'],
      ['plain 12,000', () => plain(12), 'windows'],
      ['plain 20,000', () => plain(20), 'windows'],
      ['plain 36,000', () => plain(36), 'windows'],
    ])('predicts what was measured in every Windows shell: %s', (_row, command, limit) => {
      expect(commandLimit(command())).toBe(limit);
    });

    it('computes the two lines of the model: the first has the path of cmd.exe, the shim one layer of carets less and its own path', () => {
      // 37 for `C:\\Windows\\system32\\cmd.exe /d /s /c `, then 8,118 for 5,079 pasted characters.
      expect(windowsLineLength(dense(5))).toBe(8155);
      expect(windowsLineLength(dense(6))).toBe(9760);
      // Few shell characters: the shim's line is the longer one, here with its deep path.
      expect(windowsLineLength(plain(7))).toBe(7463);
      expect(windowsLineLength(plain(7), 63)).toBe(7463 - 260 + 63);
    });

    describe('the rows measured in all six Windows shell variants', () => {
      /** The runner's: D:\\a\\_temp\\windows-check\\loupe-windows-check\\node_modules\\.bin\\ */
      const RUNNER_BIN_PATH = 63;
      const measured = (command: string): boolean => windowsLineLength(`${command} --list`, RUNNER_BIN_PATH) <= 8191;
      const inCalibration = (title: string): string => rerunCommand([target(title, { file: 'calibration.spec.ts', project: 'main' })]);
      const denseTitle = (count: number): string => `dense ${'word '.repeat(count)}end`;
      const plainTitle = (count: number): string => `plain ${'x'.repeat(count)}`;

      it.each<[string, string, boolean]>([
        ['dense 3,000', dense(3), true],
        ['dense 4,000', dense(4), true],
        ['dense 5,000', dense(5), true],
        ['dense 6,000', dense(6), false],
        ['dense 7,000', dense(7), false],
        ['dense 8,000', dense(8), false],
        ['dense step, line 8155 then', inCalibration(denseTitle(1005)), false],
        ['dense step, line 8171 then', inCalibration(denseTitle(1007)), false],
        ['dense step, line 8179 then', inCalibration(denseTitle(1008)), false],
        ['dense step, line 8187 then', inCalibration(denseTitle(1009)), false],
        ['dense step, line 8195 then', inCalibration(denseTitle(1010)), false],
        ['dense step, line 8219 then', inCalibration(denseTitle(1013)), false],
        ['dense step, line 8259 then', inCalibration(denseTitle(1018)), false],
        ['plain 7,000', plain(7), true],
        ['plain 9,000', plain(9), false],
        ['plain 12,000', plain(12), false],
        ['plain step, line 8161 then', inCalibration(plainTitle(7693)), true],
        ['plain step, line 8211 then', inCalibration(plainTitle(7743)), true],
        ['plain step, line 8261 then', inCalibration(plainTitle(7793)), true],
        ['plain step, line 8311 then', inCalibration(plainTitle(7843)), true],
        ['plain step, line 8361 then', inCalibration(plainTitle(7893)), true],
        ['plain step, line 8411 then', inCalibration(plainTitle(7943)), false],
        ['plain step, line 8461 then', inCalibration(plainTitle(7993)), false],
        ['plain step, line 8511 then', inCalibration(plainTitle(8043)), false],
        ['plain step, line 8561 then', inCalibration(plainTitle(8093)), false],
      ])('%s', (_row, command, passed) => {
        expect(measured(command)).toBe(passed);
      });

      it('warns before every command that failed, even on a shallow path', () => {
        // The notice assumes a deep path and keeps a margin: it may warn a little early, never late.
        const failed = [dense(6), inCalibration(denseTitle(1005)), inCalibration(plainTitle(7943)), plain(9)];
        for (const command of failed) expect(commandLimit(command)).toBe('windows');
      });
    });

    it('takes a quoted file and project as one argument, and counts their quotes', () => {
      const bare = windowsLineLength(rerunCommand([target('t', { project: 'ab' })]));
      const spaced = windowsLineLength(rerunCommand([target('t', { project: 'a b' })]));
      // On the shim's line, one caret per character: in the flag a letter, its caret, two quotes and theirs; in -g a letter and its caret.
      expect(spaced - bare).toBe(8);
    });

    const npmEscape = path.join(path.dirname(process.execPath), '../lib/node_modules/npm/node_modules/@npmcli/promise-spawn/lib/escape.js');
    it.skipIf(!existsSync(npmEscape))('follows the escaping of the npm that is installed', () => {
      const { cmd } = createRequire(import.meta.url)(npmEscape) as { cmd: (input: string, doubleEscape: boolean) => string };
      const commands = [
        rerunCommand([target('logs in', { file: 'tests/login.spec.ts' })]),
        rerunCommand([target('t', { file: 'tests/[id]/(group)/a+b c.spec.ts', project: 'Mobile (iOS) + x' })]),
        rerunCommand([target('$ " ` % ! \\ ^ & | < > / . * + ? ( ) [ ] { } é 🚀', { suitePath: ['s t'], tags: ['@a'], project: 'Sécu "q" $x' })]),
        rerunCommand([target('one'), target('two', { file: 'b.spec.ts', project: 'firefox' })]),
        dense(3),
        plain(2),
      ];
      for (const command of commands) {
        const args = (command.match(/"[^"]*"|[^ ]+/g) ?? []).map((token) => token.replace(/^"|"$/g, '')).slice(2);
        const doubled = args.map((arg) => cmd(arg, true)).join(' ');
        const once = args.map((arg) => cmd(arg, false)).join(' ');
        // 37 and `playwright`, or 380 for the shim with its deep path, each followed by the space of the first argument.
        expect(windowsLineLength(command)).toBe(Math.max(37 + 10 + 1 + doubled.length, 380 + 1 + once.length));
      }
    });
  });

  it('tells which limit a command is above: Windows from its escaped length, Linux from 131,072 bytes', () => {
    expect(WINDOWS_LINE_LENGTH).toBe(8161);
    expect(LINUX_COMMAND_BYTES).toBe(131072);
    expect(commandLimit(rerunCommand([target('t')]))).toBeNull();
    expect(commandLimit(`npx playwright ${'x'.repeat(WINDOWS_LINE_LENGTH - 380 - 1)}`)).toBeNull();
    expect(commandLimit(`npx playwright ${'x'.repeat(WINDOWS_LINE_LENGTH - 380)}`)).toBe('windows');
    expect(commandLimit(`npx playwright ${'x'.repeat(LINUX_COMMAND_BYTES - 'npx playwright '.length)}`)).toBe('windows');
    expect(commandLimit(`npx playwright ${'x'.repeat(LINUX_COMMAND_BYTES)}`)).toBe('linux');
  });

  it('counts bytes for the Linux limit, now that letters are literal', () => {
    // 50,000 characters, 150,000 bytes: too long for Linux, whatever its length in characters.
    expect(commandLimit('日'.repeat(50_000))).toBe('linux');
    expect(commandNotice('日'.repeat(50_000))).toContain('150,000 bytes');
    const tests = Array.from({ length: 300 }, (_, index) => target(`é ${index} 日本語のタイトル`, { file: 'tests/été.spec.ts', project: 'Sécurité', suitePath: ['Émission'] }));
    const command = rerunCommand(tests);
    expect(Buffer.byteLength(command)).toBeGreaterThan(command.length);
  });

  it('says nothing below the limits, gives the way out above the Windows one, explains and gives --last-failed above the Linux one', () => {
    expect(commandNotice(rerunCommand([target('t')]))).toBeNull();
    expect(commandNotice(`npx playwright ${'x'.repeat(WINDOWS_LINE_LENGTH)}`)).toBe('Too long for Windows once npx escapes it (limit 8,191 characters): run it in bash or zsh on Linux or macOS, or rerun fewer tests.');
    const linux = commandNotice('x'.repeat(LINUX_COMMAND_BYTES + 1));
    expect(linux).toContain('Too long to copy: 131,073 bytes');
    expect(linux).toContain('131,072 of a Linux argument');
    expect(linux).toContain('npx playwright test --last-failed');
    expect(linux).toContain('last local run, which can differ from this report');
  });

  it('shortens a long list by writing shared prefixes once', () => {
    const tests = Array.from({ length: 100 }, (_, index) => target(`test ${index}`, { file: 'tests/some/long/path/to/a.spec.ts', suitePath: ['A rather long describe title'] }));
    const flat = tests.map((test) => rerunCommand([test]).length).reduce((total, length) => total + length, 0);
    expect(rerunCommand(tests).length).toBeLessThan(flat / 5);
  });

  it('keeps the trace quoting for POSIX shells', () => {
    expect(shellQuote('tests/login.spec.ts:12')).toBe('tests/login.spec.ts:12');
    expect(shellQuote('my tests/a b.spec.ts:1')).toBe("'my tests/a b.spec.ts:1'");
    expect(shellQuote("it's $HOME;`x`")).toBe(`'it'\\''s $HOME;\`x\`'`);
  });

  it('offers the failed tests of the file only when another test failed, not the same test in another project', () => {
    const twin = [makeTest({ project: 'a', outcome: 'failed', title: 't' }), makeTest({ project: 'b', outcome: 'failed', title: 't' })];
    expect(fileRerun(twin, twin[0]!)).toBeNull();
    const flakyOther = [...twin, makeTest({ project: 'a', outcome: 'flaky', title: 'other' })];
    expect(fileRerun(flakyOther, twin[0]!)).toBeNull();
  });

  it('offers them whatever the lines: tests built in a loop share one, and a recorded line can be wrong', () => {
    const loop = [makeTest({ outcome: 'failed', line: 5, title: 'param 1' }), makeTest({ outcome: 'failed', line: 5, title: 'param 2' })];
    expect(fileRerun(loop, loop[0]!)?.label).toBe('2 failed tests in this file');
    const sameTitle = [makeTest({ outcome: 'failed', line: 5, title: 'same', suitePath: ['a'] }), makeTest({ outcome: 'failed', line: 9, title: 'same', suitePath: ['b'] })];
    expect(fileRerun(sameTitle, sameTitle[0]!)?.label).toBe('2 failed tests in this file');
    const moved = [makeTest({ outcome: 'failed', line: 5, title: 't' }), makeTest({ outcome: 'failed', line: 900, title: 't', project: 'other' })];
    expect(fileRerun(moved, moved[0]!)).toBeNull();
  });

  it('labels the failed tests of the file in short, by distinct tests; the scope names the projects', () => {
    const one = [makeTest({ project: 'a', outcome: 'failed', title: 'x' }), makeTest({ project: 'a', outcome: 'failed', title: 'y' })];
    expect(fileRerun(one, one[0]!)).toMatchObject({ label: '2 failed tests in this file', scope: '2 failed tests in this file, in a' });
    const same = [...one, makeTest({ project: 'b', outcome: 'failed', title: 'x' }), makeTest({ project: 'b', outcome: 'failed', title: 'y' })];
    expect(fileRerun(same, same[0]!)).toMatchObject({ label: '2 failed tests in this file', scope: '2 failed tests in this file, in a, b' });
    const different = [...one, makeTest({ project: 'b', outcome: 'failed', title: 'x' })];
    expect(fileRerun(different, different[0]!)).toMatchObject({ label: '2 failed tests in this file', scope: 'failed tests in this file: 2 in a, 1 in b' });
    // As many in each project, not the same tests: per project, never "1 failed test, in a, b" beside "2 failed tests".
    const crossed = [makeTest({ project: 'a', outcome: 'failed', title: 'x' }), makeTest({ project: 'b', outcome: 'failed', title: 'y' })];
    expect(fileRerun(crossed, crossed[0]!)).toMatchObject({ label: '2 failed tests in this file', scope: 'failed tests in this file: 1 in a, 1 in b' });
    const repeated = [...one, makeTest({ project: 'a', outcome: 'failed', title: 'x', repeatEachIndex: 1 })];
    expect(fileRerun(repeated, repeated[0]!)?.label).toBe('2 failed tests in this file');
  });

  it('keeps the label short whatever the projects', () => {
    const projects = Array.from({ length: 12 }, (_, index) => `project-with-a-long-name-${index}`);
    const tests = projects.flatMap((project) => ['x', 'y'].map((title) => makeTest({ project, outcome: 'failed', title })));
    expect(fileRerun(tests, tests[0]!)).toMatchObject({ label: '2 failed tests in this file', scope: `2 failed tests in this file, in ${projects.join(', ')}` });
  });

  it('counts as one the titles left identical by two home directories, as with a secret', () => {
    const tests = [makeTest({ outcome: 'failed', title: '~/x' }), makeTest({ outcome: 'failed', title: '~/x' }), makeTest({ outcome: 'failed', title: 'other' })];
    expect(fileRerun(tests, tests[0]!)?.label).toBe('2 failed tests in this file');
  });

  it('counts as two a title with `~` and the same title with the redaction marker, which differ', () => {
    const tests = [makeTest({ outcome: 'failed', title: 'a ~ b' }), makeTest({ outcome: 'failed', title: `a ${REDACTED} b` })];
    expect(fileRerun(tests, tests[0]!)?.label).toBe('2 failed tests in this file');
  });

  it('reruns the failed tests of the file with one command for the projects that share them', () => {
    const tests = ['a', 'b'].flatMap((project) => [makeTest({ project, outcome: 'failed', line: 3, title: 'one' }), makeTest({ project, outcome: 'failed', line: 9, title: 'two' })]);
    expect(rerunCommand(fileRerun(tests, tests[0]!)!.tests)).toBe('npx playwright test a.spec.ts --project=a --project=b -g "^ *(a|b) a.spec.ts (one|two)$"');
  });

  it('keeps failed tests only: flaky tests passed on a retry', () => {
    const tests = [makeTest({ outcome: 'failed' }), makeTest({ outcome: 'flaky' }), makeTest(), makeTest({ outcome: 'failed', file: 'b.spec.ts' })];
    expect(failedTests(tests)).toEqual([tests[0], tests[3]]);
    expect(failedTestsInFile(tests, 'a.spec.ts')).toEqual([tests[0]]);
  });
});

describe('AI prompt', () => {
  // The nested step failure of the fixture suite (fixtures/tests/structure.spec.ts), as the report stores it.
  const failure = error(
    [
      'Error: expect(locator).toHaveText(expected) failed',
      '',
      "Locator:  locator('#total')",
      'Expected: "15.00"',
      'Received: "12.00"',
      'Timeout:  300ms',
      '',
      'Call log:',
      `  - Expect "toHaveText" locator('#total') with timeout 300ms`,
      "  - waiting for locator('#total')",
      '    6 × locator resolved to <p id="total">12.00</p>',
      '      - unexpected value "12.00"',
      '',
    ].join('\n'),
    {
      signature: '0123456789abcdef',
      location: { file: 'structure.spec.ts', line: 23, column: 46 },
      snippet: [
        "  21 |       await page.setContent('<p id=\"total\">12.00</p>');",
        "  22 |       await test.step('check the total', async () => {",
        "> 23 |         await expect(page.locator('#total')).toHaveText('15.00', { timeout: 300 });",
        '     |                                              ^',
        '  24 |       });',
      ].join('\n'),
      stack: [
        'Error: expect(locator).toHaveText(expected) failed',
        '    at structure.spec.ts:23:46',
        '    at structure.spec.ts:22:7',
      ].join('\n'),
    },
  );
  const steps: Step[] = [
    step('Before Hooks', 'hook', { steps: [step('Fixture "page"', 'fixture')] }),
    step('open the cart', 'test.step', {
      error: failure,
      steps: [
        step('Set content', 'pw:api'),
        step('check the total', 'test.step', {
          error: failure,
          steps: [step('Expect "toHaveText"', 'expect', { subtitle: "locator('#total')", error: failure })],
        }),
      ],
    }),
  ];
  const failedAttempt = (index: number): Attempt =>
    attempt(index, 'failed', {
      errors: [failure],
      steps,
      attachments: [
        { name: 'video', contentType: 'video/webm', kind: 'video', path: `data/x/${index}/video.webm`, body: null, comparison: null },
        { name: 'trace', contentType: 'application/zip', kind: 'trace', path: `data/x/${index}/trace.zip`, body: null, comparison: null },
      ],
    });
  const test = makeTest({
    project: 'chromium-a',
    file: 'structure.spec.ts',
    line: 19,
    suitePath: ['structure'],
    title: 'fails inside a nested step (intentional)',
    tags: ['@layer:ui'],
    annotations: [{ type: 'issue', description: 'CART-12' }],
    outcome: 'failed',
    category: 'Assertion',
    attempts: [failedAttempt(0), failedAttempt(1)],
  });

  it('describes the attempt in English, with the stack by default', () => {
    expect(buildAiPrompt(test, test.attempts[1] as Attempt, { includeStack: true })).toMatchSnapshot();
  });

  it('leaves the stack out when configured', () => {
    const prompt = buildAiPrompt(test, test.attempts[1] as Attempt, { includeStack: false });
    expect(prompt).not.toContain('Stack:');
    expect(prompt).not.toContain('structure.spec.ts:22:7');
    expect(prompt).toContain('Expected: "15.00"');
    expect(prompt).toContain("> 23 |");
    expect(prompt).toContain('open the cart › check the total › Expect "toHaveText" (locator(\'#total\'))');
  });

  describe('stack block', () => {
    const MESSAGE = 'Error: expect(received).toBe(expected)\n\nExpected: 2\nReceived: 1';
    const promptOf = (fields: Partial<LoupeError>, includeStack = true) => {
      const failed = attempt(0, 'failed', { errors: [error(MESSAGE, fields)] });
      return buildAiPrompt(makeTest({ attempts: [failed] }), failed, { includeStack });
    };
    const stackBlock = (prompt: string) => /\nStack:\n```\n([\s\S]*?)\n```\n/.exec(prompt)?.[1] ?? null;

    it('keeps the frame lines only: the message is not repeated', () => {
      const stack = `${MESSAGE}\n    at expectTwo (../helpers/resources.ts:4:3)\n    at async a.spec.ts:9:5`;
      const prompt = promptOf({ stack, location: { file: '../helpers/resources.ts', line: 4, column: 3 } });
      expect(stackBlock(prompt)).toBe('    at expectTwo (../helpers/resources.ts:4:3)\n    at async a.spec.ts:9:5');
      expect(prompt.split('Expected: 2')).toHaveLength(2);
    });

    it('has no stack block for a frameless error', () => {
      expect(promptOf({ stack: MESSAGE })).not.toContain('Stack:');
      expect(promptOf({ stack: 'Error: thrown elsewhere' })).not.toContain('Stack:');
    });

    it('has no stack block when its only frame is the error location', () => {
      const location = { file: 'a.spec.ts', line: 9, column: 5 };
      expect(promptOf({ stack: `${MESSAGE}\n    at a.spec.ts:9:5`, location })).not.toContain('Stack:');
      expect(promptOf({ stack: `${MESSAGE}\n    at Context.<anonymous> (a.spec.ts:9:5)\n`, location })).not.toContain('Stack:');
      // Elsewhere, or without a location to print instead, the frame stays.
      expect(stackBlock(promptOf({ stack: `${MESSAGE}\n    at a.spec.ts:12:5`, location }))).toBe('    at a.spec.ts:12:5');
      expect(stackBlock(promptOf({ stack: `${MESSAGE}\n    at a.spec.ts:9:5` }))).toBe('    at a.spec.ts:9:5');
    });

    it('keeps the lines after the first frame, a nested cause included, in order', () => {
      const tail = ['    at load (a.spec.ts:9:5)', '[cause]: Error: ENOENT', '    at read (../helpers/files.ts:2:1)'];
      const location = { file: 'a.spec.ts', line: 9, column: 5 };
      expect(stackBlock(promptOf({ stack: [MESSAGE, ...tail].join('\n'), location }))).toBe(tail.join('\n'));
      // A cause after the error's only frame keeps the block.
      expect(stackBlock(promptOf({ stack: [MESSAGE, ...tail.slice(0, 2)].join('\n'), location }))).toBe(tail.slice(0, 2).join('\n'));
    });

    it('prints no stack when includeStack is off', () => {
      const off = promptOf({ stack: `${MESSAGE}\n    at a.spec.ts:12:5` }, false);
      expect(off).not.toContain('Stack:');
      expect(off).not.toContain('a.spec.ts:12:5');
    });
  });

  it("lists each annotation once, though the attempt holds a copy of the test's", () => {
    const annotated = attempt(0, 'failed', { annotations: [{ type: 'issue', description: 'CART-12' }, { type: 'slow', description: null }] });
    const prompt = buildAiPrompt({ ...test, attempts: [annotated] }, annotated, { includeStack: false });
    expect(prompt).toContain('- Annotations: issue: CART-12; slow\n');
  });

  it('uses a fence longer than any backtick run of the message', () => {
    const attemptWithFence = attempt(0, 'failed', { errors: [error('Expected: ```code```')] });
    expect(buildAiPrompt(makeTest({ attempts: [attemptWithFence] }), attemptWithFence, { includeStack: true })).toContain('````\nExpected: ```code```\n````');
  });
});

describe('test navigation', () => {
  // In the JSON (execution) order; titles chosen so that title order differs from declaration order.
  const tests = [
    makeTest({ title: 'z passes', file: 'a.spec.ts', line: 1, durationMs: 300 }),
    makeTest({ title: 'y fails', outcome: 'failed', file: 'b.spec.ts', line: 4, durationMs: 100 }),
    makeTest({ title: 'x fails', outcome: 'failed', file: 'b.spec.ts', line: 20, durationMs: 200 }),
    makeTest({ title: 'w fails', outcome: 'failed', file: 'a.spec.ts', line: 30, durationMs: 400 }),
    makeTest({ title: 'v is flaky', outcome: 'flaky', file: 'a.spec.ts', line: 7, durationMs: 50 }),
  ];
  const ranks = buildSortRanks(tests, ['chromium']);
  const titles = (list: readonly TestCase[]) => list.map((test) => test.title);
  const sequence = (search: string) => testSequence(tests, parseFilters(search), NO_FILTER_CONTEXT, ranks);

  it("without a sort parameter, follows the Tests view's default sort (declaration order), not the JSON order", () => {
    expect(titles(sequence(''))).toEqual(['z passes', 'v is flaky', 'w fails', 'y fails', 'x fails']);
    expect(titles(sequence(''))).not.toEqual(titles(tests));
  });

  it('with a sort parameter, follows that sort', () => {
    expect(titles(sequence('sort=duration:desc'))).toEqual(['w fails', 'z passes', 'x fails', 'y fails', 'v is flaky']);
    expect(titles(sequence('sort=title:asc'))).toEqual(['v is flaky', 'w fails', 'x fails', 'y fails', 'z passes']);
  });

  it('keeps the filtered tests only, in the current sort order', () => {
    expect(titles(sequence('status=failed'))).toEqual(['w fails', 'y fails', 'x fails']);
    expect(titles(sequence('sort=status:asc'))).toEqual(['w fails', 'y fails', 'x fails', 'v is flaky', 'z passes']);
    expect(titles(sequence('status=failed&sort=duration:asc'))).toEqual(['y fails', 'x fails', 'w fails']);
  });

  it('gives the position and neighbors, without wrap-around at the ends', () => {
    const list = sequence('');
    expect(neighbors(list, list[0])).toEqual({ position: 1, total: 5, previous: null, next: list[1] });
    expect(neighbors(list, list[4])).toEqual({ position: 5, total: 5, previous: list[3], next: null });
    expect(neighbors(list.slice(0, 2), list[4])).toEqual({ position: null, total: 2, previous: null, next: null });
  });
});

describe('error group navigation', () => {
  const groupTest = (outcome: 'failed' | 'flaky', message: string, category: string) =>
    makeTest({
      outcome,
      attempts: outcome === 'failed' ? [attempt(0, 'failed', { errors: [error(message, { category })] })] : [attempt(0, 'failed', { errors: [error(message, { category })] }), attempt(1, 'passed')],
    });
  const tests = [
    groupTest('flaky', 'network flake', 'Network'),
    groupTest('failed', 'assertion A', 'Assertion'),
    groupTest('failed', 'timeout', 'Timeout'),
    groupTest('failed', 'assertion A', 'Assertion'),
    groupTest('failed', 'assertion B', 'Assertion'),
  ];
  const groups = errorGroups({ tests });
  const signatures = (list: readonly { signature: string }[]) => list.map((group) => group.signature);
  const bySignature = (signature: string) => groups.find((group) => group.signature === signature)!;

  it("walks every group in the Errors view's order: most failed, then flaky", () => {
    expect(signatures(groupSequence(groups))).toEqual(['assertion A', 'timeout', 'assertion B', 'network flake']);
  });

  it('walks the groups of the category filter only, same order', () => {
    expect(signatures(groupSequence(groups, ['Assertion']))).toEqual(['assertion A', 'assertion B']);
    expect(signatures(groupSequence(groups, ['Network', 'Assertion']))).toEqual(['assertion A', 'assertion B', 'network flake']);
  });

  it('stops at the ends of the sequence', () => {
    const first = groupNavigation(groups, bySignature('assertion A'), ['Assertion']);
    expect(first).toMatchObject({ position: 1, total: 2, previous: null, restricted: true });
    expect(first.next?.signature).toBe('assertion B');
    const last = groupNavigation(groups, bySignature('network flake'), []);
    expect(last).toMatchObject({ position: 4, total: 4, next: null, restricted: false });
  });

  it('walks every group when the category filter does not include the group', () => {
    expect(groupNavigation(groups, bySignature('timeout'), ['Assertion'])).toMatchObject({ position: 2, total: 4, restricted: false });
  });
});
