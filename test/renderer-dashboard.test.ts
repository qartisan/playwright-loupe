import { describe, expect, it } from 'vitest';
import {
  NO_CATEGORY,
  DIMENSION_BARS_MAX,
  caseVariants,
  categoryCounts,
  dimensionRepresentation,
  formatPassRate,
  tileOrder,
  tileSummary,
  worstStatus,
  dimensionDistributions,
  errorGroups,
  errorHeadline,
  firstLine,
  flakyTests,
  groupAttempts,
  groupSummary,
  outcomeShares,
  passRate,
  projectSummaries,
  rankGroups,
  skippedTests,
  slowestTests,
  verdict,
} from '../src/renderer/dashboard.js';
import type { Attempt, AttemptStatus, LoupeError, LoupeReport, Project, Run, Stats, TestCase } from '../src/schema/v1.js';

let nextId = 1;

function error(signature: string, category: string | null = 'Assertion', message = `Error ${signature}\nmore detail`): LoupeError {
  return { message, stack: null, location: null, snippet: null, signature, category };
}

function attempt(index: number, status: AttemptStatus, errors: LoupeError[] = [], durationMs = 100): Attempt {
  return {
    index,
    status,
    startedAt: '2026-10-16T00:00:00.000Z',
    durationMs,
    workerIndex: 0,
    errors,
    steps: [],
    attachments: [],
    annotations: [],
    stdout: { text: '', truncated: false },
    stderr: { text: '', truncated: false },
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

/** A failed test: every attempt fails with the given errors. */
function failed(errors: LoupeError[], fields: Partial<TestCase> = {}, attempts = 1): TestCase {
  return makeTest({ outcome: 'failed', attempts: Array.from({ length: attempts }, (_, index) => attempt(index, 'failed', errors)), ...fields });
}

/** A flaky test: the first attempt fails, the retry passes. */
function flaky(errors: LoupeError[], fields: Partial<TestCase> = {}): TestCase {
  return makeTest({ outcome: 'flaky', attempts: [attempt(0, 'failed', errors), attempt(1, 'passed')], ...fields });
}

function stats(partial: Partial<Stats> = {}): Stats {
  return { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0, ...partial };
}

function project(name: string, partial: Partial<Stats> = {}): Project {
  return { name, testDir: '.', retries: 0, timeoutMs: 30_000, stats: stats(partial) };
}

describe('errorGroups', () => {
  it('groups the errors of failing attempts by signature, each test once, with the attempts where they occurred', () => {
    const a = failed([error('aaa')], {}, 3);
    const b = flaky([error('aaa'), error('bbb', 'Timeout')]);
    const groups = errorGroups({ tests: [a, b] });
    expect(groups.map((group) => [group.signature, group.category, group.tests.map(({ test, attempts }) => [test.id, attempts])])).toEqual([
      ['aaa', 'Assertion', [[a.id, [0, 1, 2]], [b.id, [0]]]],
      ['bbb', 'Timeout', [[b.id, [0]]]],
    ]);
    expect(groups[0]?.message).toBe('Error aaa\nmore detail');
    expect(groups.map(({ failed: f, flaky: fl }) => [f, fl])).toEqual([
      [1, 1],
      [0, 1],
    ]);
  });

  it('counts a test once when one attempt has the same error twice', () => {
    const test = failed([error('aaa'), error('aaa')]);
    expect(errorGroups({ tests: [test] })[0]?.tests).toEqual([{ test, attempts: [0] }]);
  });

  it('leaves out passing attempts, expected failures and skipped tests', () => {
    // test.fail() that failed as expected: the attempt status is the expected one.
    const expectedFailure = makeTest({ outcome: 'passed', expectedStatus: 'failed', attempts: [attempt(0, 'failed', [error('exp')])] });
    const skipped = makeTest({ outcome: 'skipped', attempts: [attempt(0, 'skipped', [error('skp')])] });
    expect(errorGroups({ tests: [expectedFailure, skipped] })).toEqual([]);
  });

  it('puts an error without category in the uncategorized bucket', () => {
    expect(errorGroups({ tests: [failed([error('aaa', null)])] })[0]?.category).toBe(NO_CATEGORY);
  });
});

describe('rankGroups ordering', () => {
  it('orders by failed tests, then flaky tests, then first occurrence, and keeps five', () => {
    const tests = [
      ...Array.from({ length: 3 }, () => flaky([error('three-flaky')])),
      failed([error('one-failed')]),
      failed([error('two-failed-one-flaky')]),
      failed([error('two-failed-one-flaky')]),
      flaky([error('two-failed-one-flaky')]),
      failed([error('two-failed')]),
      failed([error('two-failed')]),
      failed([error('x1')]),
      flaky([error('x1')]),
      failed([error('x2')]),
    ];
    const top = rankGroups(errorGroups({ tests })).slice(0, 5);
    // A group of three flaky tests ranks below any group with a failed test.
    expect(top.map((group) => [group.signature, group.failed, group.flaky])).toEqual([
      ['two-failed-one-flaky', 2, 1],
      ['two-failed', 2, 0],
      ['x1', 1, 1],
      ['one-failed', 1, 0],
      ['x2', 1, 0],
    ]);
    expect(rankGroups(errorGroups({ tests: tests.slice(0, 3) }))[0]).toMatchObject({ signature: 'three-flaky', failed: 0, flaky: 3 });
  });

  it('takes the first non-empty line of a message', () => {
    expect(firstLine('\n  Error: boom  \nat x')).toBe('Error: boom');
    expect(firstLine('')).toBe('');
  });
});

describe('categoryCounts', () => {
  const categories = [
    { name: 'Timeout', color: '#000000', builtIn: true },
    { name: 'Assertion', color: '#000000', builtIn: true },
    { name: 'Network', color: '#000000', builtIn: true },
    { name: 'Uncategorized', color: '#000000', builtIn: true },
  ];

  it('counts distinct failing tests per category, in the report category order, with their groups', () => {
    const a = failed([error('a1', 'Assertion'), error('a2', 'Assertion')]);
    const b = flaky([error('a1', 'Assertion'), error('t1', 'Timeout')]);
    const c = failed([error('u1', 'Uncategorized')]);
    const counts = categoryCounts({ categories }, errorGroups({ tests: [a, b, c] }));
    expect(counts.map(({ name, tests, groups }) => [name, tests, groups.map((group) => group.signature)])).toEqual([
      ['Timeout', 1, ['t1']],
      ['Assertion', 2, ['a1', 'a2']],
      ['Uncategorized', 1, ['u1']],
    ]);
  });

  it('keeps a category missing from the definitions, after the known ones', () => {
    const counts = categoryCounts({ categories }, errorGroups({ tests: [failed([error('z', 'Custom')]), failed([error('t', 'Timeout')])] }));
    expect(counts.map((count) => count.name)).toEqual(['Timeout', 'Custom']);
  });
});

describe('verdict', () => {
  const run = (status: Run['status'], partial: Partial<Stats>, errors: Run['errors'] = []) => ({ run: { status, stats: stats(partial), errors } as Run });

  it('is failed when a test failed, the run did not pass or has run errors, flaky when a test was flaky, passed otherwise', () => {
    const runError = { message: 'boom', stack: null, location: null, snippet: null, signature: 'x', category: 'Network', project: null };
    expect(verdict(run('passed', { passed: 3 }, [runError]))).toBe('failed');
    expect(verdict(run('failed', { failed: 1, flaky: 1 }))).toBe('failed');
    expect(verdict(run('failed', {}))).toBe('failed');
    expect(verdict(run('interrupted', { passed: 3 }))).toBe('failed');
    expect(verdict(run('passed', { passed: 2, flaky: 1 }))).toBe('flaky');
    expect(verdict(run('passed', { passed: 2, skipped: 1 }))).toBe('passed');
    expect(verdict(run('passed', {}))).toBe('passed');
  });
});

describe('projectSummaries', () => {
  it('gives the pass rate among the tests that ran and the summed test time, leaving out empty projects', () => {
    const tests = [
      makeTest({ project: 'chromium', durationMs: 1000 }),
      makeTest({ project: 'chromium', durationMs: 500 }),
      makeTest({ project: 'firefox', durationMs: 0, outcome: 'skipped' }),
    ];
    const summaries = projectSummaries({
      projects: [project('chromium', { total: 4, passed: 2, failed: 1, flaky: 0, skipped: 1 }), project('firefox', { total: 1, skipped: 1 }), project('webkit')],
      tests,
    });
    expect(summaries.map(({ project: p, passRate, durationMs }) => [p.name, passRate, durationMs])).toEqual([
      ['chromium', 2 / 3, 1500],
      ['firefox', null, 0],
    ]);
  });
});

describe('dimensionDistributions', () => {
  it('counts outcomes per value: declared values first (even unused), then unknown values flagged and sorted', () => {
    const tests = [
      makeTest({ dimensions: { Layer: ['api'] } }),
      failed([error('e')], { dimensions: { Layer: ['api', 'ui'] } }),
      flaky([error('e')], { dimensions: { Layer: ['zeta'] } }),
      makeTest({ dimensions: { Layer: ['alpha'] }, outcome: 'skipped' }),
      makeTest({}),
    ];
    const [layer] = dimensionDistributions({
      dimensions: [{ name: 'Layer', source: 'tag', key: 'layer', values: ['ui', 'api', 'db'] }],
      tests,
    });
    expect(layer?.values.map(({ value, passed, failed: f, flaky: fl, skipped, total, unknown }) => [value, passed, f, fl, skipped, total, unknown])).toEqual([
      ['ui', 0, 1, 0, 0, 1, false],
      ['api', 1, 1, 0, 0, 2, false],
      ['db', 0, 0, 0, 0, 0, false],
      ['alpha', 0, 0, 0, 1, 1, true],
      ['zeta', 0, 0, 1, 0, 1, true],
    ]);
    expect(layer?.without).toBe(1);
  });

  it('flags nothing when the dimension declares no values', () => {
    const [bug] = dimensionDistributions({
      dimensions: [{ name: 'Bug', source: 'annotation', key: 'bug', values: null }],
      tests: [makeTest({ dimensions: { Bug: ['BUG-2', 'BUG-1', 'BUG-1'] } })],
    });
    expect(bug?.values.map(({ value, total, unknown }) => [value, total, unknown])).toEqual([
      ['BUG-1', 1, false],
      ['BUG-2', 1, false],
    ]);
  });
});

describe('slowestTests', () => {
  it('keeps the ten slowest by total duration, skipped and zero-duration tests left out, ties in report order', () => {
    const tests = Array.from({ length: 12 }, (_, index) => makeTest({ title: `t${index}`, durationMs: (index % 6) * 100 }));
    tests.push(makeTest({ title: 'skipped', outcome: 'skipped', durationMs: 10_000 }));
    tests.push(failed([error('e')], { title: 'retried', durationMs: 900 }, 3));
    expect(slowestTests({ tests }).map((test) => test.title)).toEqual(['retried', 't5', 't11', 't4', 't10', 't3', 't9', 't2', 't8', 't1']);
  });
});

describe('skippedTests', () => {
  it('lists skipped tests with the reason of their skip or fixme annotation', () => {
    const tests = [
      makeTest({ title: 'plain', outcome: 'skipped' }),
      makeTest({ title: 'reasoned', outcome: 'skipped', annotations: [{ type: 'skip', description: ' not on CI ' }] }),
      makeTest({
        title: 'runtime',
        outcome: 'skipped',
        attempts: [{ ...attempt(0, 'skipped'), annotations: [{ type: 'skip', description: 'feature flag off' }] }],
      }),
      makeTest({ title: 'fixme', outcome: 'skipped', annotations: [{ type: 'fixme', description: null }] }),
      makeTest({ title: 'ran' }),
    ];
    expect(skippedTests({ tests }).map(({ test, kind, reason }) => [test.title, kind, reason])).toEqual([
      ['plain', null, null],
      ['reasoned', 'skip', 'not on CI'],
      ['runtime', 'skip', 'feature flag off'],
      ['fixme', 'fixme', null],
    ]);
  });
});

/** Messages as Playwright 1.64 reports them (from the fixture suite, ANSI codes stripped). */
const PLAYWRIGHT = {
  toHaveText: `Error: expect(locator).toHaveText(expected) failed

Locator:  getByRole('heading', { level: 1 })
Expected: "Wrong heading"
Received: "Loupe fixture"
Timeout:  500ms

Call log:
  - Expect "toHaveText" getByRole('heading', { level: 1 }) with timeout 500ms
  - waiting for getByRole('heading', { level: 1 })
    6 × locator resolved to <h1>Loupe fixture</h1>`,
  toBeVisible: `Error: expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: 'Missing' })
Expected: visible
Timeout: 300ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('button', { name: 'Missing' }) with timeout 300ms`,
  notToBeVisible: `Error: expect(locator).not.toBeVisible() failed

Locator:  getByText('Loading')
Expected: not visible
Received: visible`,
  toHaveScreenshot: `Error: expect(locator).toHaveScreenshot(expected) failed

Locator: locator('div')
  10000 pixels (ratio 1.00 of all image pixels) are different.

  Snapshot: square.png`,
  toBeOK: `Error: expect(response).toBeOK() failed


Call log:
→ GET http://127.0.0.1:36595/api/orders
  accept: */*
← 429 Too Many Requests
  date: Fri, 16 Oct 2026 09:25:27 GMT`,
  toBeGreaterThan: `Error: expect(received).toBeGreaterThan(expected)

Expected: > 0
Received:   0`,
  customMessage: `Error: fails on the first attempt on purpose

expect(received).toBeGreaterThan(expected)

Expected: > 0
Received:   0`,
  actionTimeout: `Error: locator.click: Timeout 1000ms exceeded.
Call log:
  - waiting for getByRole('button')`,
  strictMode: `Error: locator.click: Error: strict mode violation: getByRole('button', { name: 'Save' }) resolved to 2 elements:
    1) <button>Save</button> aka getByRole('button', { name: 'Save', exact: true })`,
  testTimeout: 'Test timeout of 1000ms exceeded.',
  network: `Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:38159/
Call log:
  - navigating to "http://127.0.0.1:38159/", waiting until "load"`,
  serverError: `Error: apiRequestContext.get: 500 Internal Server Error
Response text:
Intentional failure
Call log:
  - ← 500 Internal Server Error`,
};

describe('errorHeadline', () => {
  it.each([
    ['toHaveText', "Locator: getByRole('heading', { level: 1 })"],
    ['toBeVisible', "Locator: getByRole('button', { name: 'Missing' })"],
    ['notToBeVisible', "Locator: getByText('Loading')"],
    ['toHaveScreenshot', "Locator: locator('div')"],
    ['toBeOK', '\u2190 429 Too Many Requests'],
    // No locator: the generic line is all there is.
    ['toBeGreaterThan', 'Error: expect(received).toBeGreaterThan(expected)'],
    // A custom message is telling: it is kept.
    ['customMessage', 'Error: fails on the first attempt on purpose'],
    ['actionTimeout', 'Error: locator.click: Timeout 1000ms exceeded.'],
    ['strictMode', "Error: locator.click: Error: strict mode violation: getByRole('button', { name: 'Save' }) resolved to 2 elements:"],
    ['testTimeout', 'Test timeout of 1000ms exceeded.'],
    ['network', 'Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:38159/'],
    // The response line only stands in for a generic matcher line.
    ['serverError', 'Error: apiRequestContext.get: 500 Internal Server Error'],
  ] as const)('picks the telling line of a %s failure', (kind, expected) => {
    expect(errorHeadline(PLAYWRIGHT[kind])).toBe(expected);
  });

  it('reads the older "Timed out ... waiting for expect" format', () => {
    const message = "Error: Timed out 5000ms waiting for expect(locator).toBeVisible()\n\nLocator: getByRole('dialog')\nExpected: visible";
    expect(errorHeadline(message)).toBe("Locator: getByRole('dialog')");
  });
});

describe('groupSummary', () => {
  it('gives the headline, the first affected test and how many others', () => {
    const a = failed([error('g', 'Assertion', PLAYWRIGHT.toBeVisible)], { title: 'first' });
    const b = flaky([error('g', 'Assertion', PLAYWRIGHT.toBeVisible)], { title: 'second' });
    const [group] = errorGroups({ tests: [a, b] });
    expect(groupSummary(group!)).toEqual({ headline: "Locator: getByRole('button', { name: 'Missing' })", firstTest: a, others: 1 });
  });
});

describe('groupAttempts', () => {
  it('says nothing when every affected test ran once', () => {
    const [group] = errorGroups({ tests: [failed([error('g')]), failed([error('g')])] });
    expect(groupAttempts(group!)).toBeNull();
  });

  it('counts the attempts of a single test: every attempt, or the first run only', () => {
    expect(groupAttempts(errorGroups({ tests: [failed([error('g')], {}, 2)] })[0]!)).toBe('failed on 2 of 2 attempts');
    // The retry passed.
    expect(groupAttempts(errorGroups({ tests: [flaky([error('g')])] })[0]!)).toBe('failed on 1 of 2 attempts');
  });

  it('counts the first run only when the retry failed differently: that test is in both groups', () => {
    const test = makeTest({ outcome: 'failed', attempts: [attempt(0, 'failed', [error('first')]), attempt(1, 'failed', [error('retry')])] });
    expect(errorGroups({ tests: [test] }).map(groupAttempts)).toEqual(['failed on 1 of 2 attempts', 'failed on 1 of 2 attempts']);
  });

  it('adds up the attempts of several tests', () => {
    const tests = [failed([error('g')], {}, 3), flaky([error('g')]), failed([error('g')])];
    expect(groupAttempts(errorGroups({ tests })[0]!)).toBe('failed on 5 of 6 attempts');
  });
});

describe('rankGroups', () => {
  it('sorts every group, without a limit', () => {
    const tests = [flaky([error('f')]), ...Array.from({ length: 7 }, (_, index) => failed([error(`g${index}`)])), failed([error('g6')])];
    const ranked = rankGroups(errorGroups({ tests }));
    expect(ranked.map((group) => group.signature)).toEqual(['g6', 'g0', 'g1', 'g2', 'g3', 'g4', 'g5', 'f']);
  });
});

describe('outcomeShares and passRate', () => {
  it('give each outcome its share of the run, leaving out empty outcomes', () => {
    expect(outcomeShares(stats({ total: 8, passed: 4, failed: 2, skipped: 2 }))).toEqual([
      { outcome: 'passed', count: 4, share: 0.5 },
      { outcome: 'failed', count: 2, share: 0.25 },
      { outcome: 'skipped', count: 2, share: 0.25 },
    ]);
    expect(outcomeShares(stats())).toEqual([]);
  });

  it('define the pass rate once: passed / (total − skipped), flaky not counted as passed', () => {
    expect(passRate(stats({ total: 8, passed: 3, failed: 2, flaky: 1, skipped: 2 }))).toBe(0.5);
    expect(passRate(stats({ total: 2, skipped: 2 }))).toBeNull();
    // Not the share of all tests: with skipped tests the two differ (95% vs 90% here).
    const run = stats({ total: 40, passed: 36, failed: 2, skipped: 2 });
    expect(formatPassRate(passRate(run) as number)).toBe('95%');
    expect(outcomeShares(run).find((share) => share.outcome === 'passed')?.share).toBe(0.9);
  });

  it('give projects the same pass rate as the verdict', () => {
    const projectStats = { total: 5, passed: 3, failed: 1, flaky: 0, skipped: 1 };
    const [summary] = projectSummaries({ projects: [project('p', projectStats)], tests: [] });
    expect(summary?.passRate).toBe(passRate(stats(projectStats)));
  });

  it('format the pass rate without rounding to 100% or 0% when it is not exact', () => {
    expect(formatPassRate(1)).toBe('100%');
    expect(formatPassRate(0.999)).toBe('99%');
    expect(formatPassRate(0.354)).toBe('35%');
    expect(formatPassRate(0.004)).toBe('<1%');
    expect(formatPassRate(0)).toBe('0%');
  });
});

describe('caseVariants', () => {
  it('pairs values that differ only by case, and nothing else', () => {
    const variants = caseVariants(['api', 'API', 'Api', 'ui', 'e2e', 'E2E', 'db']);
    expect(Object.fromEntries(variants)).toEqual({
      api: ['API', 'Api'],
      API: ['api', 'Api'],
      Api: ['api', 'API'],
      e2e: ['E2E'],
      E2E: ['e2e'],
    });
  });

  it('flags case variants in a dimension distribution, both declared and undeclared, without merging them', () => {
    const tests = [makeTest({ dimensions: { Layer: ['api'] } }), failed([error('e')], { dimensions: { Layer: ['API'] } }), makeTest({ dimensions: { Layer: ['ui'] } })];
    const [layer] = dimensionDistributions({ dimensions: [{ name: 'Layer', source: 'tag', key: 'layer', values: ['api', 'ui'] }], tests });
    expect(layer?.values.map(({ value, total, unknown, caseVariants: twins }) => [value, total, unknown, twins])).toEqual([
      ['api', 1, false, ['API']],
      ['ui', 1, false, []],
      ['API', 1, true, ['api']],
    ]);
  });
});

describe('flakyTests', () => {
  it('lists flaky tests with the first error of their failing attempt', () => {
    const first = error('f1', 'Timeout', PLAYWRIGHT.testTimeout);
    const test = makeTest({ outcome: 'flaky', attempts: [attempt(0, 'failed', [first, error('f2')]), attempt(1, 'failed', [error('f3')]), attempt(2, 'passed')] });
    const silent = makeTest({ outcome: 'flaky', attempts: [attempt(0, 'failed'), attempt(1, 'passed')] });
    expect(flakyTests({ tests: [makeTest(), test, failed([error('x')]), silent] })).toEqual([
      { test, error: first },
      { test: silent, error: null },
    ]);
  });
});

describe('dimension representation', () => {
  const values = (count: number) => Array.from({ length: count }, (_, index) => ({ value: `v${index}` }));

  it(`uses one bar per value up to ${DIMENSION_BARS_MAX} values, tiles above`, () => {
    expect(DIMENSION_BARS_MAX).toBe(8);
    expect(dimensionRepresentation({ values: values(0) as never })).toBe('bars');
    expect(dimensionRepresentation({ values: values(DIMENSION_BARS_MAX) as never })).toBe('bars');
    expect(dimensionRepresentation({ values: values(DIMENSION_BARS_MAX + 1) as never })).toBe('tiles');
  });

  const row = (value: string, counts: Partial<Record<'passed' | 'failed' | 'flaky' | 'skipped', number>>) => {
    const filled = { passed: 0, failed: 0, flaky: 0, skipped: 0, ...counts };
    return { value, ...filled, total: filled.passed + filled.failed + filled.flaky + filled.skipped, unknown: false, caseVariants: [] };
  };

  it('takes the worst status of a value: failed, then flaky, then passed, then skipped', () => {
    expect(worstStatus(row('a', { passed: 5, failed: 1, flaky: 2 }))).toBe('failed');
    expect(worstStatus(row('a', { passed: 5, flaky: 1 }))).toBe('flaky');
    expect(worstStatus(row('a', { passed: 5, skipped: 3 }))).toBe('passed');
    expect(worstStatus(row('a', { skipped: 3 }))).toBe('skipped');
    expect(worstStatus(row('a', {}))).toBe('none');
  });

  it('orders tiles with problem values first, the most failing first', () => {
    const rows = [
      row('ok-1', { passed: 3 }),
      row('flaky', { passed: 1, flaky: 1 }),
      row('fail-1', { failed: 1 }),
      row('empty', {}),
      row('fail-3', { failed: 3, passed: 9 }),
      row('skipped', { skipped: 1 }),
      row('ok-2', { passed: 1 }),
    ];
    expect(tileOrder(rows).map((r) => r.value)).toEqual(['fail-3', 'fail-1', 'flaky', 'ok-1', 'ok-2', 'skipped', 'empty']);
  });

  it('sums up the tiles in one line', () => {
    const rows = [...Array.from({ length: 36 }, (_, index) => row(`ok${index}`, { passed: 1 })), row('a', { failed: 1 }), row('b', { failed: 2 })];
    expect(tileSummary(rows)).toBe('38 values · 36 all passed · 2 with failures');
    expect(tileSummary([row('x', { flaky: 1 }), row('y', { skipped: 1 }), row('z', {})])).toBe('3 values · 1 flaky · 1 skipped only · 1 without tests');
  });
});
