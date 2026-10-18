import { describe, expect, it } from 'vitest';
import { errorGroups } from '../src/renderer/dashboard.js';
import { buildAiPrompt } from '../src/renderer/detail/aiPrompt.js';
import { attemptLabel, defaultAttempt, selectAttempt } from '../src/renderer/detail/attempts.js';
import { joinQuery, parseDetailParams, serializeDetailParams } from '../src/renderer/detail/params.js';
import { failedTests, failedTestsInFile, fileRerun, rerunCommand, shellQuote } from '../src/renderer/detail/rerun.js';
import { groupNavigation, groupSequence, neighbors, testSequence } from '../src/renderer/detail/sequence.js';
import { failingPath, failingStepContext, stepTree, type StepNode } from '../src/renderer/detail/steps.js';
import { NO_FILTER_CONTEXT } from '../src/renderer/filters/match.js';
import { buildSortRanks } from '../src/renderer/filters/sort.js';
import { EMPTY_FILTERS } from '../src/renderer/filters/url.js';
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
  it('reruns one test by file:line and project', () => {
    expect(rerunCommand([{ file: 'tests/login.spec.ts', line: 12, project: 'chromium' }])).toBe(
      'npx playwright test tests/login.spec.ts:12 --project=chromium',
    );
  });

  it('leaves out --project for an unnamed project', () => {
    expect(rerunCommand([{ file: 'login.spec.ts', line: 3, project: '' }])).toBe('npx playwright test login.spec.ts:3');
  });

  it('reruns only the test itself in a multi-project run, not its twin in the other project', () => {
    const tests = [makeTest({ project: 'chromium-a', outcome: 'failed', line: 34 }), makeTest({ project: 'chromium-b', outcome: 'failed', line: 34 })];
    expect(rerunCommand([tests[0]!])).toBe('npx playwright test a.spec.ts:34 --project=chromium-a');
  });

  it('gives one command with repeated --project flags when projects have the same arguments', () => {
    const command = rerunCommand([
      { file: 'a.spec.ts', line: 3, project: 'chromium' },
      { file: 'b.spec.ts', line: 9, project: 'chromium' },
      { file: 'b.spec.ts', line: 9, project: 'firefox' },
      { file: 'a.spec.ts', line: 3, project: 'firefox' },
      { file: 'a.spec.ts', line: 3, project: 'chromium' },
    ]);
    expect(command).toBe('npx playwright test a.spec.ts:3 b.spec.ts:9 --project=chromium --project=firefox');
  });

  it('splits into one command per project, joined with &&, when the arguments differ', () => {
    const command = rerunCommand([
      { file: 'a.spec.ts', line: 3, project: 'chromium' },
      { file: 'b.spec.ts', line: 9, project: 'firefox' },
      { file: 'a.spec.ts', line: 12, project: 'chromium' },
      { file: 'b.spec.ts', line: 9, project: 'chromium' },
      { file: 'a.spec.ts', line: 3, project: 'webkit' },
      { file: 'b.spec.ts', line: 9, project: 'webkit' },
      { file: 'a.spec.ts', line: 12, project: 'webkit' },
    ]);
    expect(command).toBe(
      'npx playwright test a.spec.ts:3 a.spec.ts:12 b.spec.ts:9 --project=chromium --project=webkit && npx playwright test b.spec.ts:9 --project=firefox',
    );
  });

  it('sorts arguments by file, then by line, whatever the order of the tests', () => {
    const command = rerunCommand([
      { file: 'tests/z.spec.ts', line: 2, project: 'p' },
      { file: 'tests/a.spec.ts', line: 100, project: 'p' },
      { file: 'tests/a.spec.ts', line: 9, project: 'p' },
      { file: 'tests/a/b.spec.ts', line: 1, project: 'p' },
    ]);
    expect(command).toBe('npx playwright test tests/a.spec.ts:9 tests/a.spec.ts:100 tests/a/b.spec.ts:1 tests/z.spec.ts:2 --project=p');
  });

  it('keeps an unnamed project in its own command, without --project', () => {
    expect(rerunCommand([{ file: 'a.spec.ts', line: 1, project: '' }, { file: 'a.spec.ts', line: 1, project: 'named' }])).toBe(
      'npx playwright test a.spec.ts:1 && npx playwright test a.spec.ts:1 --project=named',
    );
  });

  it('quotes paths and project names with spaces or shell-special characters', () => {
    expect(shellQuote('tests/login.spec.ts:12')).toBe('tests/login.spec.ts:12');
    expect(shellQuote('my tests/a b.spec.ts:1')).toBe("'my tests/a b.spec.ts:1'");
    expect(shellQuote("it's $HOME;`x`")).toBe(`'it'\\''s $HOME;\`x\`'`);
    expect(rerunCommand([{ file: 'a.spec.ts', line: 1, project: "Gilles's suite" }])).toBe(`npx playwright test a.spec.ts:1 --project='Gilles'\\''s suite'`);
    expect(rerunCommand([{ file: 'e2e/a b.spec.ts', line: 4, project: 'Mobile Safari' }])).toBe(
      "npx playwright test 'e2e/a b.spec.ts:4' --project='Mobile Safari'",
    );
  });

  it('is empty for no test', () => {
    expect(rerunCommand([])).toBe('');
  });

  it('offers the failed tests of the file only when another line failed, not the same test in another project', () => {
    const twin = [makeTest({ project: 'a', outcome: 'failed', line: 34 }), makeTest({ project: 'b', outcome: 'failed', line: 34 })];
    expect(fileRerun(twin, twin[0]!)).toBeNull();
    const flakyOther = [...twin, makeTest({ project: 'a', outcome: 'flaky', line: 50 })];
    expect(fileRerun(flakyOther, twin[0]!)).toBeNull();
  });

  it('labels the failed tests of the file by distinct file:line per project, naming the projects when there are several', () => {
    const one = [makeTest({ project: 'a', outcome: 'failed', line: 3 }), makeTest({ project: 'a', outcome: 'failed', line: 9 })];
    expect(fileRerun(one, one[0]!)?.label).toBe('2 failed tests in this file');
    const same = [...one, makeTest({ project: 'b', outcome: 'failed', line: 3 }), makeTest({ project: 'b', outcome: 'failed', line: 9 })];
    expect(fileRerun(same, same[0]!)).toMatchObject({ label: '2 failed tests in this file, in a, b' });
    expect(rerunCommand(fileRerun(same, same[0]!)!.tests)).toBe('npx playwright test a.spec.ts:3 a.spec.ts:9 --project=a --project=b');
    const different = [...one, makeTest({ project: 'b', outcome: 'failed', line: 3 })];
    expect(fileRerun(different, different[0]!)?.label).toBe('failed tests in this file: 2 in a, 1 in b');
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
        '    at <root>/fixtures/tests/structure.spec.ts:23:46',
        '    at <root>/fixtures/tests/structure.spec.ts:22:7',
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
    expect(prompt).not.toContain('<root>/fixtures');
    expect(prompt).toContain('Expected: "15.00"');
    expect(prompt).toContain("> 23 |");
    expect(prompt).toContain('open the cart › check the total › Expect "toHaveText" (locator(\'#total\'))');
  });

  it('uses a fence longer than any backtick run of the message', () => {
    const attemptWithFence = attempt(0, 'failed', { errors: [error('Expected: ```code```')] });
    expect(buildAiPrompt(makeTest({ attempts: [attemptWithFence] }), attemptWithFence, { includeStack: true })).toContain('````\nExpected: ```code```\n````');
  });
});

describe('test navigation', () => {
  const tests = [
    makeTest({ title: 'b passes', durationMs: 300 }),
    makeTest({ title: 'a fails', outcome: 'failed', durationMs: 100 }),
    makeTest({ title: 'c fails', outcome: 'failed', durationMs: 200 }),
    makeTest({ title: 'd is flaky', outcome: 'flaky', durationMs: 50 }),
  ];
  const ranks = buildSortRanks(tests);
  const titles = (list: readonly TestCase[]) => list.map((test) => test.title);

  it("follows the Tests view's default order without filter", () => {
    expect(titles(testSequence(tests, EMPTY_FILTERS, NO_FILTER_CONTEXT, ranks))).toEqual(['a fails', 'c fails', 'd is flaky', 'b passes']);
  });

  it('keeps the filtered tests only, in the current sort order', () => {
    const state = { ...EMPTY_FILTERS, facets: { status: ['failed'] }, sort: { column: 'duration', direction: 'desc' } } as const;
    expect(titles(testSequence(tests, state, NO_FILTER_CONTEXT, ranks))).toEqual(['c fails', 'a fails']);
  });

  it('gives the position and neighbors, without wrap-around at the ends', () => {
    const list = testSequence(tests, EMPTY_FILTERS, NO_FILTER_CONTEXT, ranks);
    expect(neighbors(list, list[0])).toEqual({ position: 1, total: 4, previous: null, next: list[1] });
    expect(neighbors(list, list[3])).toEqual({ position: 4, total: 4, previous: list[2], next: null });
    expect(neighbors(list.slice(0, 2), list[3])).toEqual({ position: null, total: 2, previous: null, next: null });
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
