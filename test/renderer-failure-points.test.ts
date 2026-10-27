import { describe, expect, it } from 'vitest';
import { cleanFunctionName, isLibraryFrame, normalizeFramePath, parseStack } from '../src/renderer/failure-points/frames.js';
import { computeFailurePoints, failurePoints } from '../src/renderer/failure-points/points.js';
import { MAX_POINTS, MIN_POINT_FILES, MIN_POINT_GROUPS, MIN_POINT_TESTS } from '../src/renderer/failure-points/thresholds.js';
import { facetCounts, filterContext, filterDomain, filterTests, testFacetValues } from '../src/renderer/filters/match.js';
import { EMPTY_FILTERS, parseFilters, serializeFilters } from '../src/renderer/filters/url.js';
import type { Attempt, AttemptStatus, LoupeError, Outcome, TestCase } from '../src/schema/v1.js';
import { cascadeReport } from './helpers/cascade.js';
import { schemaErrors } from './helpers/schema.js';

/** A frame as the core writes it: `file` relative to the root dir, or absolute when it shares no named directory with it. */
function frame(fn: string | null, file: string, line = 10): string {
  const location = `${file}:${line}:5`;
  return fn === null ? `    at ${location}` : `    at ${fn} (${location})`;
}

/** An error whose stack holds `frames` (innermost first), then the test file's own frame. */
function error(signature: string, test: { file: string }, frames: string[], category: string | null = null): LoupeError {
  const stack = ['Error: failed', ...frames, frame(null, test.file, 3)].join('\n');
  return { message: 'Error: failed', stack, location: null, snippet: null, signature, category };
}

function attempt(index: number, status: AttemptStatus, errors: LoupeError[] = []): Attempt {
  return {
    index,
    status,
    startedAt: '2026-10-01T00:00:00.000Z',
    durationMs: 1,
    workerIndex: 0,
    errors,
    steps: [],
    attachments: [],
    annotations: [],
    stdout: { text: '', truncated: false },
    stderr: { text: '', truncated: false },
  };
}

let nextId = 1;

interface Spec {
  file: string;
  title?: string;
  project?: string;
  outcome?: Outcome;
  /** One failing attempt per entry: [signature, frames, category]. */
  errors: Array<[string, string[], string?]>;
}

function makeTest({ file, title, project = 'p1', outcome = 'failed', errors }: Spec): TestCase {
  const id = String(nextId++).padStart(16, '0');
  const test: TestCase = {
    id,
    repeatEachIndex: 0,
    project,
    file,
    line: 1,
    column: 1,
    suitePath: ['suite'],
    title: title ?? `test ${id}`,
    tags: [],
    annotations: [],
    outcome,
    expectedStatus: 'passed',
    durationMs: 1,
    dimensions: {},
    category: null,
    errorSignature: null,
    attempts: [],
  };
  test.attempts = errors.map(([signature, frames, category], index) => attempt(index, 'failed', [error(signature, test, frames, category ?? null)]));
  if (outcome === 'flaky') test.attempts.push(attempt(test.attempts.length, 'passed'));
  return test;
}

/** `count` tests, each in its own file among `files` (cycled), alternating between `signatures`. */
function through(frames: string[], count: number, options: { files?: number; signatures?: string[]; prefix?: string } = {}): TestCase[] {
  const files = options.files ?? count;
  const signatures = options.signatures ?? ['g1', 'g2'];
  return Array.from({ length: count }, (_, index) =>
    makeTest({
      file: `tests/${options.prefix ?? 'f'}${index % files}.spec.ts`,
      title: `${options.prefix ?? 'f'} ${index}`,
      errors: [[signatures[index % signatures.length] as string, frames]],
    }),
  );
}

const points = (tests: TestCase[]) => computeFailurePoints({ tests }).points;
const keys = (tests: TestCase[]) => points(tests).map((point) => point.key);

describe('parseStack', () => {
  it('reads named and anonymous V8 frames', () => {
    const stack = ['Error: boom', '    at login (/repo/app/pages/login.page.ts:12:7)', '    at /repo/app/tests/a.spec.ts:3:5', 'not a frame'].join('\n');
    expect(parseStack(stack)).toEqual([
      { fn: 'login', path: '/repo/app/pages/login.page.ts', line: 12 },
      { fn: null, path: '/repo/app/tests/a.spec.ts', line: 3 },
    ]);
  });

  it('handles async frames, named and anonymous', () => {
    expect(parseStack('E\n    at async signIn (/r/a.ts:1:2)\n    at async /r/b.ts:3:4')).toEqual([
      { fn: 'signIn', path: '/r/a.ts', line: 1 },
      { fn: null, path: '/r/b.ts', line: 3 },
    ]);
  });

  it('strips file://, converts Windows separators and decodes percent-encoding', () => {
    expect(parseStack('E\n    at go (file:///C:/work/my%20app/pages/x.ts:5:1)\n    at C:\\work\\app\\y.ts:6:2')).toEqual([
      { fn: 'go', path: 'C:/work/my app/pages/x.ts', line: 5 },
      { fn: null, path: 'C:/work/app/y.ts', line: 6 },
    ]);
    expect(normalizeFramePath('file:///repo/a%23b.ts')).toBe('/repo/a#b.ts');
    // A literal `%` that is not an escape is kept.
    expect(normalizeFramePath('/repo/100%.ts')).toBe('/repo/100%.ts');
  });

  it('keeps a frame without a position, with a null line', () => {
    expect(parseStack('E\n    at Array.forEach (<anonymous>)')).toEqual([{ fn: 'Array.forEach', path: '<anonymous>', line: null }]);
  });

  it('returns nothing for a missing stack or one without frames', () => {
    expect(parseStack(null)).toEqual([]);
    expect(parseStack('Test timeout of 30000ms exceeded.')).toEqual([]);
  });
});

describe('cleanFunctionName', () => {
  it.each([
    ['async signIn', 'signIn'],
    ['Object.memberFactory', 'memberFactory'],
    ['AuthService.loginAs', 'AuthService.loginAs'],
    ['new ApiClient', 'ApiClient'],
    ['Proxy.fill [as fillField]', 'Proxy.fill'],
    ['Object.<anonymous>', null],
    ['<anonymous>', null],
    [null, null],
  ])('%s → %s', (raw, expected) => {
    expect(cleanFunctionName(raw)).toBe(expected);
  });
});

describe('isLibraryFrame', () => {
  it.each([
    ['/repo/node_modules/some-lib/index.js', true],
    ['node:internal/process/task_queues', true],
    ['node:fs', true],
    ['/repo/node_modules/playwright-core/lib/client/locator.js', true],
    ['/opt/playwright/packages/playwright-core/lib/server/page.js', true],
    ['<anonymous>', true],
    ['native', true],
    ['/repo/app/pages/login.page.ts', false],
    ['/repo/app/lib/helpers.ts', false],
  ])('%s → %s', (path, expected) => {
    expect(isLibraryFrame(path)).toBe(expected);
  });
});

describe('computeFailurePoints', () => {
  const helper = frame('checkResponse', 'lib/http.ts', 21);

  it(`shows a point with at least ${MIN_POINT_TESTS} tests, ${MIN_POINT_FILES} files and ${MIN_POINT_GROUPS} groups`, () => {
    expect(keys(through([helper], MIN_POINT_TESTS, { files: MIN_POINT_FILES }))).toEqual(['lib/http.ts#checkResponse']);
  });

  it.each([
    ['tests', { count: MIN_POINT_TESTS - 1, files: MIN_POINT_FILES, signatures: ['g1', 'g2'] }],
    ['files', { count: MIN_POINT_TESTS, files: MIN_POINT_FILES - 1, signatures: ['g1', 'g2'] }],
    ['groups', { count: MIN_POINT_TESTS, files: MIN_POINT_FILES, signatures: ['g1'] }],
  ])('hides a point one short of the %s threshold', (_name, { count, files, signatures }) => {
    expect(points(through([helper], count, { files, signatures }))).toEqual([]);
  });

  it('counts a test run in several projects once', () => {
    const tests = through([helper], MIN_POINT_TESTS - 1, { files: MIN_POINT_FILES });
    const copy = { ...(tests[0] as TestCase), id: 'copy000000000000', project: 'p2' };
    expect(points([...tests, copy])).toEqual([]);
    const [point] = points([...tests, copy, ...through([helper], 1, { prefix: 'other' })]);
    expect(point?.tests).toBe(MIN_POINT_TESTS);
  });

  it('splits failed and flaky tests, a test failed in any project counting as failed', () => {
    const tests = through([helper], 5, { files: 3 });
    const flaky = makeTest({ file: 'tests/z.spec.ts', title: 'flaky one', outcome: 'flaky', errors: [['g1', [helper]]] });
    const flakyHere = makeTest({ file: 'tests/z.spec.ts', title: 'mixed', outcome: 'flaky', errors: [['g1', [helper]]] });
    const failedThere = makeTest({ file: 'tests/z.spec.ts', title: 'mixed', project: 'p2', errors: [['g1', [helper]]] });
    expect(points([...tests, flaky, flakyHere, failedThere])[0]).toMatchObject({ tests: 7, failed: 6, flaky: 1 });
  });

  it('records the groups, categories and lines seen', () => {
    const tests = [
      makeTest({ file: 'tests/a.spec.ts', errors: [['g1', [frame('save', 'lib/s.ts', 30)], 'Timeout']] }),
      makeTest({ file: 'tests/b.spec.ts', errors: [['g2', [frame('save', 'lib/s.ts', 12)], 'Network']] }),
      makeTest({ file: 'tests/c.spec.ts', errors: [['g2', [frame('save', 'lib/s.ts', 30)], 'Network']] }),
      makeTest({ file: 'tests/c.spec.ts', errors: [['g3', [frame('save', 'lib/s.ts', 30)]]] }),
      makeTest({ file: 'tests/c.spec.ts', errors: [['g3', [frame('save', 'lib/s.ts', 30)]]] }),
    ];
    expect(points(tests)).toEqual([
      expect.objectContaining({ key: 'lib/s.ts#save', file: 'lib/s.ts', fn: 'save', lines: [12, 30], tests: 5, files: 3, signatures: ['g1', 'g2', 'g3'], categories: ['Timeout', 'Network', 'Uncategorized'] }),
    ]);
  });

  it('keys a function by file and name, not by line', () => {
    const tests = through([frame('save', 'lib/s.ts', 1)], 3).concat(through([frame('save', 'lib/s.ts', 2)], 2, { prefix: 'g' }));
    expect(points(tests)).toEqual([expect.objectContaining({ key: 'lib/s.ts#save', tests: 5, lines: [1, 2] })]);
  });

  it('keeps frames outside the root dir, with `../` in the key', () => {
    expect(keys(through([frame('send', '../packages/client.ts')], 5))).toEqual(['../packages/client.ts#send']);
  });

  it('keys a frame left absolute by the core with its absolute path', () => {
    expect(keys(through([frame('send', '/opt/shared/client.ts')], 5))).toEqual(['/opt/shared/client.ts#send']);
  });

  it('leaves out test files, anonymous frames and library frames', () => {
    const tests = through(
      [frame('helperInSpec', 'tests/f0.spec.ts'), frame(null, 'lib/anon.ts'), frame('Object.<anonymous>', 'lib/anon.ts'), frame('lib', 'node_modules/x/i.js'), frame('dep', '../node_modules/y/j.js'), frame('tick', 'node:internal/timers')],
      6,
    );
    expect(points(tests)).toEqual([]);
  });

  it('uses the failing attempts only, interrupted ones included', () => {
    const tests = through([helper], 5);
    for (const test of tests) (test.attempts[0] as Attempt).status = 'passed';
    expect(points(tests)).toEqual([]);
    for (const test of tests) (test.attempts[0] as Attempt).status = 'interrupted';
    expect(keys(tests)).toEqual(['lib/http.ts#checkResponse']);
  });

  describe('folding', () => {
    const inner = frame('checkResponse', 'lib/http.ts');
    const outer = frame('fetchResource', 'lib/resources.ts');

    it('folds a function into its caller when its tests are a subset', () => {
      const tests = [...through([inner, outer], 5), ...through([outer], 1, { prefix: 'only-outer' })];
      expect(points(tests)).toEqual([
        expect.objectContaining({ key: 'lib/resources.ts#fetchResource', tests: 6, via: [{ key: 'lib/http.ts#checkResponse', file: 'lib/http.ts', fn: 'checkResponse' }] }),
      ]);
    });

    it('does not fold a subset that is not always reached through the other function', () => {
      // checkResponse is sometimes called without fetchResource in the stack: both stay.
      const tests = [...through([inner, outer], 5), ...through([outer], 1, { prefix: 'o' })];
      const lone = makeTest({ file: 'tests/f1.spec.ts', title: 'f 1', errors: [['g1', [inner]]] });
      // Same test identity as one already counted, so the subset holds, but this stack lacks the caller.
      expect(keys([...tests, { ...lone, id: 'lone000000000000', project: 'p2' }])).toEqual(['lib/resources.ts#fetchResource', 'lib/http.ts#checkResponse']);
    });

    it('does not fold a callee into its caller the other way round', () => {
      const tests = through([inner, outer], 5);
      expect(points(tests).map((point) => [point.key, point.via.map((via) => via.fn)])).toEqual([['lib/resources.ts#fetchResource', ['checkResponse']]]);
    });

    it('keeps both points on a partial overlap', () => {
      const tests = [...through([inner, outer], 5), ...through([inner], 5, { prefix: 'i' })];
      expect(keys(tests)).toEqual(['lib/http.ts#checkResponse', 'lib/resources.ts#fetchResource']);
    });

    it('folds under the caller with the fewest tests, then the outermost, and lists every folded function', () => {
      const middle = frame('withRetry', 'lib/retry.ts');
      // inner ⊂ middle ⊂ outer, each reached only through the next: one point, two folded.
      const tests = [...through([inner, middle, outer], 5), ...through([middle, outer], 1, { prefix: 'm' }), ...through([outer], 1, { prefix: 'o' })];
      expect(points(tests).map((point) => [point.key, point.via.map((via) => via.fn)])).toEqual([['lib/resources.ts#fetchResource', ['withRetry', 'checkResponse']]]);
      // Same tests for both callers: the outermost wins.
      const tie = through([inner, middle, outer], 5);
      expect(points(tie).map((point) => [point.key, point.via.map((via) => via.fn)])).toEqual([['lib/resources.ts#fetchResource', ['checkResponse', 'withRetry']]]);
    });
  });

  it(`ranks by tests, then files, then key, and shows at most ${MAX_POINTS}`, () => {
    const tests = Array.from({ length: MAX_POINTS + 2 }, (_, index) =>
      through([frame(`helper${index}`, `lib/h${index}.ts`)], 5 + (index % 3), { files: index === 1 ? 3 : 5, prefix: `h${index}-` }),
    ).flat();
    expect(keys(tests)).toEqual(['lib/h2.ts#helper2', 'lib/h5.ts#helper5', 'lib/h4.ts#helper4', 'lib/h1.ts#helper1', 'lib/h0.ts#helper0']);
  });

  it('is cached per test list', () => {
    const tests = through([helper], 5);
    expect(failurePoints({ tests })).toBe(failurePoints({ tests }));
  });
});

describe('the synthetic cascade sample', () => {
  const report = cascadeReport();

  it('is a valid schema v1 report', () => {
    expect(schemaErrors(report)).toEqual([]);
  });

  it('gives the documented points', () => {
    const result = computeFailurePoints(report);
    expect(result.points.map(({ key, tests, failed, flaky, files, signatures, via }) => ({ key, tests, failed, flaky, files, groups: signatures.length, via: via.map((inner) => inner.fn) }))).toEqual([
      { key: 'fixtures/session.fixtures.ts#signIn', tests: 10, failed: 8, flaky: 2, files: 8, groups: 3, via: ['AccountService.loginWith'] },
      { key: 'fixtures/data.fixtures.ts#readerFactory', tests: 6, failed: 6, flaky: 0, files: 5, groups: 2, via: [] },
      { key: '../packages/api-client/src/client.ts#ApiClient.send', tests: 5, failed: 5, flaky: 0, files: 5, groups: 2, via: [] },
    ]);
    expect(result.points[0]?.lines).toEqual([41, 58]);
  });
});

describe('the failure point facet', () => {
  const report = cascadeReport();
  const context = filterContext(report);
  const domain = filterDomain(report);
  const SIGN_IN = 'fixtures/session.fixtures.ts#signIn';
  const READER = 'fixtures/data.fixtures.ts#readerFactory';

  it('comes after the error category, with the shown points only, in rank order', () => {
    expect([...domain.keys()].slice(0, 4)).toEqual(['status', 'category', 'point', 'project']);
    expect([...(domain.get('point') ?? [])]).toEqual([SIGN_IN, READER, '../packages/api-client/src/client.ts#ApiClient.send']);
  });

  it('is hidden when the report has no point', () => {
    expect(filterDomain({ ...report, tests: report.tests.filter((test) => test.outcome === 'passed') }).has('point')).toBe(false);
  });

  it('matches the tests whose failing attempts have the point in a stack, every project', () => {
    const matched = filterTests(report.tests, { ...EMPTY_FILTERS, facets: { point: [SIGN_IN] } }, context);
    // 10 tests, two of them in two projects.
    expect(matched).toHaveLength(12);
    expect(new Set(matched.map((test) => test.title)).size).toBe(10);
    // The folded AccountService.loginWith is not a value; its tests are signIn's.
    expect(testFacetValues(matched[0] as TestCase, 'point', context)).toEqual([SIGN_IN]);
    const both = report.tests.find((test) => test.title === 'renews a loan') as TestCase;
    expect(testFacetValues(both, 'point', context)).toEqual([SIGN_IN, READER]);
  });

  it('counts tests per point with the other filters applied', () => {
    const counts = facetCounts(report.tests, { ...EMPTY_FILTERS, facets: { status: ['flaky'] } }, domain, context);
    expect(counts.get('point')?.get(SIGN_IN)).toBe(2);
    expect(counts.get('point')?.get(READER)).toBe(0);
  });

  it('round-trips through the URL, `#` encoded, and drops an unknown value', () => {
    const state = { ...EMPTY_FILTERS, facets: { point: [SIGN_IN], category: ['Timeout'] } };
    const query = serializeFilters(state);
    expect(query).toBe('category=Timeout&point=fixtures%2Fsession.fixtures.ts%23signIn');
    expect(parseFilters(query, domain)).toEqual(parseFilters(serializeFilters(parseFilters(query, domain)), domain));
    expect(parseFilters(query, domain).facets.point).toEqual([SIGN_IN]);
    expect(parseFilters(`#/tests?point=${encodeURIComponent('lib/gone.ts#nothing')},${encodeURIComponent(SIGN_IN)}`, domain).facets.point).toEqual([SIGN_IN]);
  });
});
