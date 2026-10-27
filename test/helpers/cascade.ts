import { BUILT_IN_RULES, UNCATEGORIZED_COLOR } from '../../src/core/categories.js';
import type { Attempt, AttemptStatus, LoupeError, LoupeReport, Outcome, Stats, TestCase } from '../../src/schema/v1.js';

/**
 * A synthetic cascade: an anonymized report shaped like a real one where one
 * sign-in fixture breaks most of a suite. The app (a library), the functions,
 * the files and the messages are invented. Used by the unit and browser tests
 * of the common failure points and of the error groups only seen after a test
 * timeout. Deterministic: the same report on every call. Frame paths are
 * relative to the root dir, as the core writes them.
 *
 * Expected, with the thresholds of src/renderer/failure-points/thresholds.ts:
 * - points, ranked: `fixtures/session.fixtures.ts#signIn` (10 tests, 8 failed
 *   and 2 flaky, 8 files, 3 groups, via `AccountService.loginWith`, which it
 *   calls), `fixtures/data.fixtures.ts#readerFactory` (6 tests, 5 files, 2
 *   groups: it shares 2 tests with signIn, so both stay), and
 *   `../packages/api-client/src/client.ts#ApiClient.send` (5 tests, 5 files,
 *   2 groups: outside the root dir). `CatalogPage.open` is in 3 tests of 2
 *   files: below the thresholds;
 * - 10 error groups, 3 of them only seen after a test timeout (`context
 *   disposed`, `page closed`, `goto aborted`), so 7 visible. `click timeout`
 *   is seen after a test timeout once and as a first error once: visible.
 *   Network has no visible group, only the folded `goto aborted`.
 */

const OUTSIDE = '../packages/';

const color = (name: string): string => BUILT_IN_RULES.find((rule) => rule.name === name)?.color ?? UNCATEGORIZED_COLOR;

/** Stack frames, innermost first. */
const FRAMES = {
  loginWith: `    at AccountService.loginWith (services/account.service.ts:22:15)`,
  signIn: (line: number) => `    at async signIn (fixtures/session.fixtures.ts:${line}:9)`,
  readerFactory: (line: number) => `    at Object.readerFactory (fixtures/data.fixtures.ts:${line}:20)`,
  send: (line: number) => `    at ApiClient.send (${OUTSIDE}api-client/src/client.ts:${line}:11)`,
  reserve: `    at ReservationService.reserve (services/reservation.service.ts:31:7)`,
  catalog: `    at CatalogPage.open (pages/catalog.page.ts:14:5)`,
  loans: `    at LoansPage.open (pages/loans.page.ts:9:5)`,
  // Playwright strips its own frames; a stack that kept them must not count them.
  library: '    at ApiRequestContext.post (node_modules/playwright-core/lib/client/fetch.js:58:11)',
} as const;

interface ErrorKind {
  signature: string;
  category: string;
  message: string;
}

export const CASCADE_ERRORS = {
  signInFailed: { signature: 'a1c0de000001', category: 'Uncategorized', message: 'Error: [Setup] Sign-in failed for the reader account: 401 Unauthorized' },
  signInTimeout: { signature: 'a1c0de000002', category: 'Timeout', message: 'Error: apiRequestContext.post: Timeout 15000ms exceeded.' },
  testTimeout: { signature: 'a1c0de000003', category: 'Timeout', message: 'Test timeout of 30000ms exceeded.' },
  contextDisposed: { signature: 'a1c0de000004', category: 'Uncategorized', message: 'Error: apiRequestContext.post: Request context disposed.' },
  pageClosed: { signature: 'a1c0de000005', category: 'Uncategorized', message: 'Error: locator.click: Target page, context or browser has been closed' },
  gotoAborted: { signature: 'a1c0de000006', category: 'Network', message: 'Error: page.goto: net::ERR_ABORTED at http://shelf.test/loans' },
  readerCleanup: { signature: 'a1c0de000007', category: 'Server error', message: 'Error: [Teardown] Could not delete the reader: 500 Internal Server Error' },
  heading: { signature: 'a1c0de000008', category: 'Assertion', message: 'Error: expect(locator).toHaveText(expected) failed' },
  clickTimeout: { signature: 'a1c0de000009', category: 'Timeout', message: 'Error: locator.click: Timeout 10000ms exceeded.' },
  reserveFailed: { signature: 'a1c0de00000a', category: 'Server error', message: 'Error: Reservation failed: 503 Service Unavailable' },
} as const satisfies Record<string, ErrorKind>;

type Kind = keyof typeof CASCADE_ERRORS;

function error(kind: Kind, file: string, frames: Frames = []): LoupeError {
  const { signature, category, message } = CASCADE_ERRORS[kind];
  const stack = kind === 'testTimeout' ? message : [message, ...frames, `    at ${file}:12:5`].join('\n');
  return { message, stack, location: null, snippet: null, signature, category };
}

type Frames = readonly string[];
type ErrorSpec = [Kind, Frames?];
type AttemptSpec = { status: AttemptStatus; errors: ErrorSpec[] };

const fail = (...errors: ErrorSpec[]): AttemptSpec => ({ status: 'failed', errors });
const timedOut = (...errors: ErrorSpec[]): AttemptSpec => ({ status: 'timedOut', errors });
const pass: AttemptSpec = { status: 'passed', errors: [] };

const SIGN_IN = [FRAMES.loginWith, FRAMES.signIn(41)];
const SIGN_IN_LIBRARY = [FRAMES.library, FRAMES.loginWith, FRAMES.signIn(58)];
const SIGN_IN_READER = [FRAMES.loginWith, FRAMES.signIn(41), FRAMES.readerFactory(77)];
const READER_CLEANUP = [FRAMES.send(48), FRAMES.readerFactory(90)];

interface TestSpec {
  file: string;
  suite: string;
  title: string;
  projects?: readonly string[];
  attempts: readonly AttemptSpec[];
}

const TESTS: readonly TestSpec[] = [
  // Through signIn (and AccountService.loginWith).
  { file: 'tests/loans/borrow.spec.ts', suite: 'loans', title: 'borrows a book', projects: ['desktop', 'mobile'], attempts: [fail(['signInFailed', SIGN_IN]), fail(['signInFailed', SIGN_IN])] },
  { file: 'tests/loans/borrow.spec.ts', suite: 'loans', title: 'renews a loan', attempts: [fail(['signInFailed', SIGN_IN_READER]), fail(['signInFailed', SIGN_IN_READER])] },
  { file: 'tests/loans/return.spec.ts', suite: 'loans', title: 'returns a book', attempts: [timedOut(['testTimeout'], ['contextDisposed', SIGN_IN]), timedOut(['testTimeout'], ['contextDisposed', SIGN_IN])] },
  { file: 'tests/loans/return.spec.ts', suite: 'loans', title: 'pays a late fee', attempts: [fail(['signInTimeout', SIGN_IN_LIBRARY]), fail(['signInTimeout', SIGN_IN_LIBRARY])] },
  { file: 'tests/catalog/search.spec.ts', suite: 'catalog', title: 'searches by author', attempts: [fail(['signInFailed', SIGN_IN]), pass] },
  { file: 'tests/catalog/details.spec.ts', suite: 'catalog', title: 'shows the availability', attempts: [fail(['signInTimeout', SIGN_IN]), fail(['signInTimeout', SIGN_IN])] },
  { file: 'tests/readers/profile.spec.ts', suite: 'readers', title: 'edits the profile', attempts: [fail(['signInFailed', SIGN_IN_READER]), fail(['signInFailed', SIGN_IN_READER])] },
  { file: 'tests/readers/history.spec.ts', suite: 'readers', title: 'lists past loans', projects: ['desktop', 'mobile'], attempts: [timedOut(['testTimeout'], ['contextDisposed', SIGN_IN]), timedOut(['testTimeout'], ['contextDisposed', SIGN_IN])] },
  { file: 'tests/admin/inventory.spec.ts', suite: 'admin', title: 'adds a copy', attempts: [fail(['signInFailed', SIGN_IN]), fail(['signInFailed', SIGN_IN])] },
  { file: 'tests/admin/reports.spec.ts', suite: 'admin', title: 'exports the loans', attempts: [fail(['signInTimeout', SIGN_IN]), pass] },
  // Through readerFactory and ApiClient.send, without signIn.
  { file: 'tests/readers/profile.spec.ts', suite: 'readers', title: 'deletes the account', attempts: [fail(['readerCleanup', READER_CLEANUP]), fail(['readerCleanup', READER_CLEANUP])] },
  { file: 'tests/readers/history.spec.ts', suite: 'readers', title: 'clears the history', attempts: [fail(['readerCleanup', READER_CLEANUP]), fail(['readerCleanup', READER_CLEANUP])] },
  { file: 'tests/admin/inventory.spec.ts', suite: 'admin', title: 'retires a copy', attempts: [fail(['readerCleanup', READER_CLEANUP]), fail(['readerCleanup', READER_CLEANUP])] },
  { file: 'tests/admin/reports.spec.ts', suite: 'admin', title: 'counts the readers', attempts: [fail(['readerCleanup', READER_CLEANUP]), fail(['readerCleanup', READER_CLEANUP])] },
  // Through ApiClient.send only.
  { file: 'tests/catalog/details.spec.ts', suite: 'catalog', title: 'reserves a copy', attempts: [fail(['reserveFailed', [FRAMES.send(63), FRAMES.reserve]]), fail(['reserveFailed', [FRAMES.send(63), FRAMES.reserve]])] },
  // Unrelated UI failures on a slow application.
  { file: 'tests/catalog/search.spec.ts', suite: 'catalog', title: 'filters by genre', attempts: [timedOut(['testTimeout'], ['pageClosed', [FRAMES.catalog]]), timedOut(['testTimeout'], ['pageClosed', [FRAMES.catalog]])] },
  { file: 'tests/catalog/details.spec.ts', suite: 'catalog', title: 'opens the reviews', attempts: [timedOut(['testTimeout'], ['clickTimeout', [FRAMES.catalog]]), timedOut(['testTimeout'], ['clickTimeout', [FRAMES.catalog]])] },
  { file: 'tests/catalog/search.spec.ts', suite: 'catalog', title: 'sorts the results', attempts: [fail(['clickTimeout', [FRAMES.catalog]]), fail(['clickTimeout', [FRAMES.catalog]])] },
  { file: 'tests/loans/borrow.spec.ts', suite: 'loans', title: 'shows the due date', attempts: [timedOut(['testTimeout'], ['gotoAborted', [FRAMES.loans]]), timedOut(['testTimeout'], ['gotoAborted', [FRAMES.loans]])] },
  { file: 'tests/catalog/details.spec.ts', suite: 'catalog', title: 'shows the cover', attempts: [fail(['heading']), fail(['heading'])] },
  // Passing and skipped.
  { file: 'tests/catalog/search.spec.ts', suite: 'catalog', title: 'lists the new arrivals', projects: ['desktop', 'mobile'], attempts: [pass] },
  { file: 'tests/admin/reports.spec.ts', suite: 'admin', title: 'prints the yearly report', attempts: [{ status: 'skipped', errors: [] }] },
];

const PROJECTS = ['desktop', 'mobile'];

function outcomeOf(attempts: readonly AttemptSpec[]): Outcome {
  const last = attempts[attempts.length - 1] as AttemptSpec;
  if (last.status === 'skipped') return 'skipped';
  if (last.status === 'passed') return attempts.length > 1 ? 'flaky' : 'passed';
  return 'failed';
}

function emptyStats(): Stats {
  return { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0 };
}

export function cascadeReport(): LoupeReport {
  const tests: TestCase[] = [];
  let index = 0;
  for (const spec of TESTS) {
    for (const project of spec.projects ?? ['desktop']) {
      index += 1;
      const outcome = outcomeOf(spec.attempts);
      const attempts: Attempt[] = spec.attempts.map((attempt, attemptIndex) => ({
        index: attemptIndex,
        status: attempt.status,
        startedAt: '2026-10-01T08:00:00.000Z',
        durationMs: attempt.status === 'timedOut' ? 30_000 : 1_200,
        workerIndex: 0,
        errors: attempt.errors.map(([kind, frames]) => error(kind, spec.file, frames)),
        steps: [],
        attachments: [],
        annotations: [],
        stdout: { text: '', truncated: false },
        stderr: { text: '', truncated: false },
      }));
      const lastFailing = [...attempts].reverse().find((attempt) => attempt.errors.length > 0);
      tests.push({
        id: index.toString(16).padStart(16, 'c'),
        repeatEachIndex: 0,
        project,
        file: spec.file,
        line: 10 + index,
        column: 3,
        suitePath: [spec.suite],
        title: spec.title,
        tags: [],
        annotations: [],
        outcome,
        expectedStatus: 'passed',
        durationMs: attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0),
        dimensions: {},
        category: lastFailing?.errors[0]?.category ?? null,
        errorSignature: lastFailing?.errors[0]?.signature ?? null,
        attempts,
      });
    }
  }
  const stats = emptyStats();
  const projectStats = new Map(PROJECTS.map((name) => [name, emptyStats()]));
  for (const test of tests) {
    for (const target of [stats, projectStats.get(test.project) as Stats]) {
      target.total += 1;
      target[test.outcome] += 1;
    }
  }
  const categories = ['Server error', 'Network', 'Assertion', 'Timeout'].map((name) => ({ name, color: color(name), builtIn: true }));
  return {
    schemaVersion: 1,
    generator: { name: 'playwright-loupe', version: '0.0.0-cascade' },
    run: {
      id: '00000000-0000-4000-8000-00000000ca5c',
      startedAt: '2026-10-01T08:00:00.000Z',
      durationMs: 600_000,
      status: 'failed',
      scope: 'full',
      scopeReasons: [],
      playwrightVersion: '1.64.0',
      workers: 4,
      shard: null,
      environment: { name: 'staging', ci: true, ciProvider: null, os: 'linux-x64', nodeVersion: 'v24.0.0' },
      git: { commit: null, branch: null, remote: null },
      excluded: null,
      notes: [],
      stats,
      errors: [],
    },
    projects: PROJECTS.map((name) => ({ name, testDir: 'tests', retries: 1, timeoutMs: 30_000, stats: projectStats.get(name) as Stats })),
    tests,
    categories: [...categories, { name: 'Uncategorized', color: UNCATEGORIZED_COLOR, builtIn: true }],
    dimensions: [],
  };
}
