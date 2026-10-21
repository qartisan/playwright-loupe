import { describe, expect, it } from 'vitest';
import { categoryCounts, errorGroups, rankGroups, splitAfterTimeout } from '../src/renderer/dashboard.js';
import { groupNavigation, groupSequence } from '../src/renderer/detail/sequence.js';
import { testCategories } from '../src/renderer/filters/match.js';
import { foldedGroupsText, groupCountText, isSecondaryError, isTestTimeout } from '../src/renderer/secondary.js';
import type { Attempt, AttemptStatus, LoupeError, TestCase } from '../src/schema/v1.js';
import { CASCADE_ERRORS, cascadeReport } from './helpers/cascade.js';

function error(message: string, signature = message): LoupeError {
  return { message, stack: null, location: null, snippet: null, signature, category: null };
}

function attempt(status: AttemptStatus, errors: LoupeError[]): Attempt {
  return {
    index: 0,
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

function makeTest(...attempts: Attempt[]): TestCase {
  const id = String(nextId++).padStart(16, '0');
  return {
    id,
    repeatEachIndex: 0,
    project: 'p',
    file: 'a.spec.ts',
    line: 1,
    column: 1,
    suitePath: [],
    title: `test ${id}`,
    tags: [],
    annotations: [],
    outcome: 'failed',
    expectedStatus: 'passed',
    durationMs: 1,
    dimensions: {},
    category: null,
    errorSignature: null,
    attempts: attempts.map((current, index) => ({ ...current, index })),
  };
}

const TIMEOUT = 'Test timeout of 30000ms exceeded.';

describe('isTestTimeout: the six messages of Playwright that stop a running test', () => {
  it('the test body', () => {
    expect(isTestTimeout('Test timeout of 30000ms exceeded.')).toBe(true);
  });

  it('a fixture being set up', () => {
    expect(isTestTimeout('Test timeout of 30000ms exceeded while setting up "signedInPage".')).toBe(true);
  });

  it('a fixture being torn down', () => {
    expect(isTestTimeout('Tearing down "signedInPage" exceeded the test timeout of 30000ms.')).toBe(true);
  });

  it('a beforeEach or afterEach hook', () => {
    expect(isTestTimeout('Test timeout of 30000ms exceeded while running "beforeEach" hook.')).toBe(true);
    expect(isTestTimeout('Test timeout of 30000ms exceeded while running "afterEach" hook.')).toBe(true);
  });

  it('a fixture with its own timeout', () => {
    expect(isTestTimeout('Fixture "seedDatabase" timeout of 60000ms exceeded during setup.')).toBe(true);
    expect(isTestTimeout('Fixture "seedDatabase" timeout of 60000ms exceeded during teardown.')).toBe(true);
  });

  it('a beforeAll or afterAll hook', () => {
    expect(isTestTimeout('"beforeAll" hook timeout of 30000ms exceeded.')).toBe(true);
    expect(isTestTimeout('"afterAll" hook timeout of 30000ms exceeded.')).toBe(true);
  });

  it('reads the first non-empty line', () => {
    expect(isTestTimeout('\nTest timeout of 1000ms exceeded.\n\nmore details')).toBe(true);
  });

  it.each([
    ['worker teardown', 'Worker teardown timeout of 30000ms exceeded.'],
    ['worker teardown of a fixture', 'Worker teardown timeout of 30000ms exceeded while tearing down "server".'],
    ['a modifier', '"skip" modifier timeout of 30000ms exceeded.'],
    ['an action timing out on the test timeout', 'Error: locator.click: Test timeout of 30000ms exceeded.'],
    ['an action timeout', 'Error: locator.click: Timeout 5000ms exceeded.'],
    ['an expect timeout', 'Error: expect(locator).toBeVisible() failed'],
  ])('does not count %s', (_name, message) => {
    expect(isTestTimeout(message)).toBe(false);
  });
});

describe('isSecondaryError', () => {
  const timedOut = attempt('timedOut', [error(TIMEOUT), error('Error: apiRequestContext.post: Request context disposed.')]);

  it('is a further error of an attempt whose first error is the test timeout', () => {
    expect(isSecondaryError(timedOut, 1)).toBe(true);
    expect(isSecondaryError(timedOut, 0)).toBe(false);
  });

  it('is never an error after another first error, or a single error', () => {
    const other = attempt('failed', [error('Error: [Setup] failed'), error('Error: teardown failed')]);
    expect(isSecondaryError(other, 1)).toBe(false);
    expect(isSecondaryError(attempt('timedOut', [error(TIMEOUT)]), 0)).toBe(false);
  });
});

describe('error groups only seen after a test timeout', () => {
  const disposed = 'Error: apiRequestContext.post: Request context disposed.';
  const closed = 'Error: locator.click: Target page, context or browser has been closed';

  it('folds a group only when every occurrence is secondary', () => {
    const tests = [
      makeTest(attempt('timedOut', [error(TIMEOUT), error(disposed), error(closed)]), attempt('timedOut', [error(TIMEOUT), error(disposed)])),
      makeTest(attempt('timedOut', [error(TIMEOUT), error(closed)])),
      // Seen once as a first error: stays visible everywhere.
      makeTest(attempt('failed', [error(closed)])),
    ];
    const groups = errorGroups({ tests });
    expect(Object.fromEntries(groups.map((group) => [group.signature, group.afterTimeout]))).toEqual({ [TIMEOUT]: false, [disposed]: true, [closed]: false });
  });

  it('keeps a group seen after another first error visible', () => {
    const tests = [makeTest(attempt('timedOut', [error(TIMEOUT), error(disposed)])), makeTest(attempt('failed', [error('Error: boom'), error(disposed)]))];
    expect(errorGroups({ tests }).find((group) => group.signature === disposed)?.afterTimeout).toBe(false);
  });

  it('leaves the categories of a test unchanged', () => {
    const test = makeTest(attempt('timedOut', [{ ...error(TIMEOUT), category: 'Timeout' }, { ...error(closed), category: 'Ambiguous locator' }]));
    expect(testCategories(test)).toEqual(['Timeout', 'Ambiguous locator']);
  });

  it('ranks the folded groups after the others, each part in the usual order', () => {
    const tests = [
      makeTest(attempt('timedOut', [error(TIMEOUT), error(disposed)])),
      makeTest(attempt('timedOut', [error(TIMEOUT), error(disposed)])),
      makeTest(attempt('failed', [error('Error: once')])),
    ];
    expect(rankGroups(errorGroups({ tests })).map((group) => group.signature)).toEqual([TIMEOUT, 'Error: once', disposed]);
  });
});

describe('on the synthetic cascade sample', () => {
  const report = cascadeReport();
  const groups = errorGroups(report);
  const ranked = rankGroups(groups);
  const { visible, folded } = splitAfterTimeout(ranked);
  const foldedSignatures = [CASCADE_ERRORS.contextDisposed, CASCADE_ERRORS.pageClosed, CASCADE_ERRORS.gotoAborted].map((kind) => kind.signature);

  it('folds the three groups only seen after a test timeout, not the one also seen first', () => {
    expect(groups).toHaveLength(10);
    expect(new Set(folded.map((group) => group.signature))).toEqual(new Set(foldedSignatures));
    expect(visible.map((group) => group.signature)).toContain(CASCADE_ERRORS.clickTimeout.signature);
    expect(groupCountText(visible.length, folded.length)).toBe('7 error groups · 3 more only seen after a test timeout');
    expect(foldedGroupsText(folded.length)).toBe('3 groups only seen after a test timeout');
  });

  it('counts groups per category without the folded ones, tests unchanged', () => {
    const counts = Object.fromEntries(
      categoryCounts(report, ranked).map((category) => {
        const split = splitAfterTimeout(category.groups);
        return [category.name, { tests: category.tests, text: groupCountText(split.visible.length, split.folded.length) }];
      }),
    );
    expect(counts['Network']).toEqual({ tests: 1, text: '0 error groups · 1 more only seen after a test timeout' });
    expect(counts['Uncategorized']).toEqual({ tests: 10, text: '1 error group · 2 more only seen after a test timeout' });
    expect(counts['Server error']).toEqual({ tests: 5, text: '2 error groups' });
  });

  it('walks the visible groups first, then the folded ones, with n / p', () => {
    const sequence = groupSequence(groups);
    expect(sequence.slice(0, visible.length).every((group) => !group.afterTimeout)).toBe(true);
    expect(sequence.slice(visible.length).map((group) => group.signature)).toEqual(folded.map((group) => group.signature));
    const lastVisible = visible[visible.length - 1];
    expect(lastVisible && groupNavigation(groups, lastVisible, []).next).toBe(folded[0]);
    // Within a category: the same order, restricted to it.
    const uncategorized = groupSequence(groups, ['Uncategorized']).map((group) => [group.signature, group.afterTimeout]);
    expect(uncategorized).toEqual([
      [CASCADE_ERRORS.signInFailed.signature, false],
      ...[CASCADE_ERRORS.contextDisposed, CASCADE_ERRORS.pageClosed].map((kind) => [kind.signature, true]),
    ]);
  });
});
