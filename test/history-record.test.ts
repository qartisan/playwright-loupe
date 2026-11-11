import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ResolvedHistory } from '../src/config/types.js';
import { DEFAULT_HISTORY } from '../src/config/resolve.js';
import { CI_RUN_ID_VARIABLES, contentHash, detectOrigin, historyRunId, streamOf } from '../src/core/history/detect.js';
import { EXCLUDE_ENV, buildRunFile, excludeReason, skipReason, type RecordContext } from '../src/core/history/record.js';
import { EXTRACT_CHARS, extract, runFileName, streamHash } from '../src/core/history/runFile.js';
import { GITIGNORE, RUNS_FOLDER, ensureHistoryFolder, writeRunFile } from '../src/core/history/write.js';
import type { HistoryRunFile } from '../src/schema/history-v1.js';
import type { Attempt, AttemptStatus, LoupeReport, Outcome, TestCase } from '../src/schema/v1.js';

const CLI = '/project/node_modules/@playwright/test/cli.js';

describe('detectOrigin', () => {
  const origin = (argv: string[], env: Record<string, string> = {}, configArgv?: string[]) =>
    detectOrigin({ argv: ['node', CLI, ...argv], env, configArgv });

  it('a plain run is local', () => {
    expect(origin(['test'])).toBe('local');
    expect(origin(['test', '--grep', 'ui', '--project=ui'])).toBe('local');
    expect(origin(['merge-reports', 'blobs'])).toBe('local');
  });

  it('VS Code variables are no signal: every terminal inside VS Code has them', () => {
    expect(origin(['test'], { VSCODE_PID: '42', TERM_PROGRAM: 'vscode', VSCODE_IPC_HOOK_CLI: '/tmp/x.sock' })).toBe('local');
  });

  it('the VS Code extension (test-server) is ide', () => {
    // The command the extension 1.1.19 starts.
    expect(origin(['test-server', '-c', 'playwright.config.ts', '--host', '127.0.0.1'])).toBe('ide');
  });

  it('UI mode is ide, in each of its forms', () => {
    expect(origin(['test', '--ui'])).toBe('ide');
    expect(origin(['test', '--ui-port=0'])).toBe('ide');
    expect(origin(['test', '--ui-port', '9323'])).toBe('ide');
    expect(origin(['test', '--ui-host=127.0.0.1'])).toBe('ide');
    // config.argv (1.61+) carries it too.
    expect(detectOrigin({ argv: ['node', 'runner.js'], env: {}, configArgv: ['--ui'] })).toBe('ide');
  });

  it('watch mode is ide', () => {
    expect(origin(['test'], { PWTEST_WATCH: '1' })).toBe('ide');
    expect(origin(['test'], { PWTEST_WATCH: '' })).toBe('local');
  });

  it('a CI wins: a merge job in CI is ci', () => {
    expect(origin(['merge-reports', 'blobs'], { GITHUB_ACTIONS: 'true' })).toBe('ci');
    expect(origin(['test'], { CI: '1' })).toBe('ci');
    expect(origin(['test', '--ui'], { CI: 'true' })).toBe('ci');
    expect(origin(['test'], { CI: 'false' })).toBe('local');
  });
});

describe('streamOf', () => {
  it('keeps the configured parts, in their order, default environment when unset', () => {
    expect(streamOf(['environment', 'origin'], { environment: null, origin: 'ci', branch: 'main' })).toEqual({ environment: 'default', origin: 'ci' });
    expect(streamOf(['branch', 'origin'], { environment: 'staging', origin: 'local', branch: null })).toEqual({ branch: null, origin: 'local' });
  });
});

const attempt = (index: number, status: AttemptStatus, startedAt = `2026-11-10T10:00:0${index}.000Z`, message?: string): Attempt => ({
  index,
  status,
  startedAt,
  durationMs: 10,
  workerIndex: 0,
  errors: message
    ? [{ message, stack: null, location: { file: 'a.spec.ts', line: 3, column: 9 }, snippet: null, signature: `sig-${message.length}`, category: 'Assertion' }]
    : [],
  steps: [],
  attachments: [],
  annotations: [],
  stdout: { text: '', truncated: false },
  stderr: { text: '', truncated: false },
});

const testCase = (id: string, outcome: Outcome, attempts: Attempt[], extra: Partial<TestCase> = {}): TestCase => ({
  id,
  repeatEachIndex: 0,
  project: 'web',
  file: 'a.spec.ts',
  line: 3,
  column: 1,
  suitePath: ['Cart'],
  title: `test ${id}`,
  tags: [],
  annotations: [],
  outcome,
  expectedStatus: 'passed',
  durationMs: attempts.length * 10,
  dimensions: {},
  category: null,
  errorSignature: null,
  attempts,
  ...extra,
});

function report(tests: TestCase[], run: Partial<LoupeReport['run']> = {}): LoupeReport {
  return {
    schemaVersion: 1,
    generator: { name: 'playwright-loupe', version: '0.4.0' },
    run: {
      id: 'report-uuid',
      startedAt: '2026-11-10T10:00:00.000Z',
      durationMs: 1234,
      status: 'failed',
      scope: 'full',
      scopeReasons: [],
      playwrightVersion: '1.64.1',
      workers: 1,
      shard: null,
      environment: { name: 'staging', ci: false, ciProvider: null, os: 'linux-x64', nodeVersion: 'v24.0.0' },
      git: { commit: 'abc', branch: 'main', remote: null },
      excluded: null,
      notes: [],
      stats: { total: tests.length, passed: 0, failed: 0, flaky: 0, skipped: 0 },
      errors: [],
      ...run,
    },
    projects: [{ name: 'web', testDir: '.', retries: 1, timeoutMs: 30000, stats: { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0 } }],
    tests,
    categories: [],
    dimensions: [],
  };
}

describe('contentHash and historyRunId', () => {
  const tests = [testCase('b', 'passed', [attempt(0, 'passed')]), testCase('a', 'failed', [attempt(0, 'failed'), attempt(1, 'failed')])];

  it('is 8 hex characters, independent of the test order', () => {
    expect(contentHash(tests)).toMatch(/^[0-9a-f]{8}$/);
    expect(contentHash([...tests].reverse())).toBe(contentHash(tests));
  });

  it('changes when the tests ran again', () => {
    const rerun = tests.map((test) => ({ ...test, attempts: test.attempts.map((a) => ({ ...a, startedAt: '2026-11-10T11:00:00.000Z' })) }));
    expect(contentHash(rerun)).not.toBe(contentHash(tests));
  });

  it('tells repeat-each copies apart', () => {
    const one = [testCase('a', 'passed', [attempt(0, 'passed', 'x')])];
    const repeated = [testCase('a', 'passed', [attempt(0, 'passed', 'x')], { repeatEachIndex: 1 })];
    expect(contentHash(one)).not.toBe(contentHash(repeated));
  });

  it('in CI: provider, CI run id and content hash; a merge-only re-run keeps it', () => {
    const env = { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '11873402', GITHUB_RUN_ATTEMPT: '1' };
    const id = historyRunId({ env, merged: true, tests });
    expect(id).toBe(`github-actions-11873402-${contentHash(tests)}`);
    expect(historyRunId({ env: { ...env, GITHUB_RUN_ATTEMPT: '2' }, merged: true, tests })).toBe(id);
  });

  it.each(Object.entries(CI_RUN_ID_VARIABLES))('%s reads %s', (provider, variable) => {
    const markers: Record<string, string> = {
      'github-actions': 'GITHUB_ACTIONS',
      gitlab: 'GITLAB_CI',
      'azure-pipelines': 'TF_BUILD',
      circleci: 'CIRCLECI',
      jenkins: 'JENKINS_URL',
      bitbucket: 'BITBUCKET_BUILD_NUMBER',
      buildkite: 'BUILDKITE',
      travis: 'TRAVIS',
    };
    const env = { [markers[provider] as string]: 'x', [variable]: '42' };
    expect(historyRunId({ env, merged: false, tests })).toBe(`${provider}-42-${contentHash(tests)}`);
  });

  it('makes a CI id safe in a file name', () => {
    const env = { JENKINS_URL: 'https://ci', BUILD_TAG: 'jenkins-team/web app-17' };
    expect(historyRunId({ env, merged: false, tests })).toBe(`jenkins-jenkins-team_web_app-17-${contentHash(tests)}`);
    expect(historyRunId({ env: { JENKINS_URL: 'x', BUILD_TAG: '../..' }, merged: false, tests, random: () => 'random' })).toBe('random');
  });

  it('outside CI: merge-<hash> for a merge, random otherwise', () => {
    expect(historyRunId({ env: {}, merged: true, tests })).toBe(`merge-${contentHash(tests)}`);
    expect(historyRunId({ env: {}, merged: false, tests, random: () => 'random' })).toBe('random');
    // A CI without a known run id variable.
    expect(historyRunId({ env: { CI: 'true' }, merged: false, tests, random: () => 'random' })).toBe('random');
    expect(historyRunId({ env: { GITHUB_ACTIONS: 'true' }, merged: true, tests })).toBe(`merge-${contentHash(tests)}`);
  });
});

describe('extract', () => {
  it('keeps a short message whole', () => {
    expect(extract('Error: boom\nsecond line')).toBe('Error: boom\nsecond line');
  });

  it('cuts a long message at the last line end before the limit', () => {
    const lines = Array.from({ length: 20 }, (_, index) => `line ${index} ${'x'.repeat(30)}`);
    const result = extract(lines.join('\n'));
    expect(result.length).toBeLessThanOrEqual(EXTRACT_CHARS);
    expect(lines.join('\n').startsWith(result)).toBe(true);
    expect(result.endsWith('x')).toBe(true);
  });

  it('cuts a single long line at the limit, never inside a surrogate pair', () => {
    expect(extract('a'.repeat(1000))).toHaveLength(EXTRACT_CHARS);
    const emoji = `${'a'.repeat(EXTRACT_CHARS - 1)}😀tail`;
    expect(extract(emoji)).toBe('a'.repeat(EXTRACT_CHARS - 1));
  });
});

const HISTORY: ResolvedHistory = { enabled: true, dir: '/unused', ...DEFAULT_HISTORY };

function context(overrides: Partial<RecordContext> = {}): RecordContext {
  return {
    history: HISTORY,
    list: false,
    merged: false,
    reporters: ['@qartisan/playwright-loupe'],
    env: {},
    argv: ['node', CLI, 'test'],
    redact: { mode: 'extend', patterns: [], values: [] },
    home: null,
    ...overrides,
  };
}

describe('which runs are recorded', () => {
  const ran = report([testCase('a', 'passed', [attempt(0, 'passed')])]);

  it('records a run where a test ran', () => {
    expect(skipReason(ran, context())).toBeNull();
  });

  it('never records with history off', () => {
    expect(skipReason(ran, context({ history: { ...HISTORY, enabled: false } }))).toBe('disabled');
  });

  it('never records --list', () => {
    expect(skipReason(ran, context({ list: true }))).toBe('list');
    expect(skipReason(report(ran.tests, { scope: 'partial', scopeReasons: ['list'] }), context())).toBe('list');
  });

  it('never records a run where no test ran (an empty shard, a run stopped before any test)', () => {
    expect(skipReason(report([]), context())).toBe('no-test-ran');
    expect(skipReason(report([testCase('a', 'skipped', [])]), context())).toBe('no-test-ran');
  });

  it('never records a run that writes a blob; the merge does', () => {
    expect(skipReason(ran, context({ reporters: ['blob', 'dist/index.js'] }))).toBe('blob');
    expect(skipReason(ran, context({ reporters: ['blob'], merged: true }))).toBeNull();
  });
});

describe('the run file', () => {
  const long = `Error: wrong total\n${'detail line\n'.repeat(60)}`;
  const tests = [
    testCase('p', 'passed', [attempt(0, 'passed')]),
    testCase('f', 'failed', [attempt(0, 'failed', undefined, long), attempt(1, 'timedOut', undefined, 'Test timeout of 30000ms exceeded.')]),
    testCase('k', 'flaky', [attempt(0, 'failed', undefined, 'Error: first'), attempt(1, 'passed')]),
    testCase('s', 'skipped', [attempt(0, 'skipped')]),
    testCase('n', 'skipped', []),
    // test.fail(): failing is expected, passing is the failure.
    testCase('x', 'passed', [attempt(0, 'failed', undefined, 'Error: expected')], { expectedStatus: 'failed' }),
    testCase('u', 'failed', [attempt(0, 'passed')], { expectedStatus: 'failed' }),
    testCase('r', 'passed', [attempt(0, 'passed')], { repeatEachIndex: 2 }),
  ];
  const run = buildRunFile(report(tests), context()) as HistoryRunFile;

  it('has the header and the run metadata', () => {
    expect({ ...run, tests: undefined }).toEqual({
      historyVersion: 1,
      signatureVersion: 6,
      loupeVersion: '0.4.0',
      playwrightVersion: '1.64.1',
      run: {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown as string,
        reportRunId: 'report-uuid',
        startedAt: '2026-11-10T10:00:00.000Z',
        durationMs: 1234,
        status: 'failed',
        origin: 'local',
        environment: 'staging',
        stream: { environment: 'staging', origin: 'local' },
        scope: 'full',
        scopeReasons: [],
        merged: false,
        excluded: null,
        ciProvider: null,
        git: { commit: 'abc', branch: 'main' },
        stats: { total: 8, passed: 0, failed: 0, flaky: 0, skipped: 0 },
        projects: [{ name: 'web', retries: 1 }],
        errors: [],
      },
      tests: undefined,
    });
  });

  it('packs each test, with the failed attempts of failed and flaky tests', () => {
    expect(run.tests).toEqual([
      { id: 'p', t: ['web', 'a.spec.ts', 'Cart', 'test p'], o: 'P', d: 10 },
      {
        id: 'f',
        t: ['web', 'a.spec.ts', 'Cart', 'test f'],
        o: 'F',
        d: 20,
        a: 'FT',
        f: [
          { i: 0, sig: [`sig-${long.length}`], cat: 'Assertion', x: extract(long), at: 'a.spec.ts:3:9' },
          { i: 1, sig: ['sig-33'], cat: 'Assertion', x: 'Test timeout of 30000ms exceeded.', at: 'a.spec.ts:3:9' },
        ],
      },
      { id: 'k', t: ['web', 'a.spec.ts', 'Cart', 'test k'], o: 'K', d: 20, a: 'FP', f: [{ i: 0, sig: ['sig-12'], cat: 'Assertion', x: 'Error: first', at: 'a.spec.ts:3:9' }] },
      { id: 's', t: ['web', 'a.spec.ts', 'Cart', 'test s'], o: 'S', d: 10 },
      { id: 'n', t: ['web', 'a.spec.ts', 'Cart', 'test n'], o: 'S', d: 0, a: '' },
      { id: 'x', t: ['web', 'a.spec.ts', 'Cart', 'test x'], o: 'P', d: 10, a: 'F' },
      { id: 'u', t: ['web', 'a.spec.ts', 'Cart', 'test u'], o: 'F', d: 10, a: 'P', f: [{ i: 0, sig: [] }] },
      { id: 'r', r: 2, t: ['web', 'a.spec.ts', 'Cart', 'test r'], o: 'P', d: 10 },
    ]);
    expect(extract(long).length).toBeLessThanOrEqual(EXTRACT_CHARS);
  });

  it('keeps the run errors, as extracts', () => {
    const withErrors = report(tests, {
      errors: [{ message: long, stack: null, location: null, snippet: null, signature: 'e1', category: null, project: null }],
    });
    expect((buildRunFile(withErrors, context()) as HistoryRunFile).run.errors).toEqual([{ sig: 'e1', cat: null, x: extract(long), at: null }]);
  });

  it('is named by start time, stream hash and run id, so names sort by time', () => {
    expect(runFileName('2026-11-10T14:02:11.408Z', '0a1b2c3d', 'merge-1a2b3c4d')).toBe('20261110T140211.408Z-0a1b2c3d-merge-1a2b3c4d.json');
  });

  it("stores the report's run.id next to the history run id", () => {
    const written = buildRunFile(report(tests), context()) as HistoryRunFile;
    expect(written.run.reportRunId).toBe(report(tests).run.id);
    expect(written.run.reportRunId).not.toBe(written.run.id);
  });

  it('writes the default environment when none is set', () => {
    const run2 = buildRunFile(report(tests, { environment: { name: null, ci: false, ciProvider: null, os: 'x', nodeVersion: 'v' } }), context()) as HistoryRunFile;
    expect([run2.run.environment, run2.run.stream]).toEqual(['default', { environment: 'default', origin: 'local' }]);
  });

  it('records the stream key as configured, with the branch', () => {
    const history = { ...HISTORY, stream: { key: ['environment', 'origin', 'branch'] as ResolvedHistory['stream']['key'] } };
    expect((buildRunFile(report(tests), context({ history })) as HistoryRunFile).run.stream).toEqual({ environment: 'staging', origin: 'local', branch: 'main' });
  });
});

describe('LOUPE_EXCLUDE', () => {
  const tests = [testCase('a', 'passed', [attempt(0, 'passed')])];

  it('records the run as excluded with the trimmed reason', () => {
    const run = buildRunFile(report(tests), context({ env: { [EXCLUDE_ENV]: '  staging was down  ' } })) as HistoryRunFile;
    expect(run.run.excluded).toEqual({ reason: 'staging was down' });
  });

  it('ignores an empty or blank value', () => {
    expect(excludeReason({ [EXCLUDE_ENV]: '   ' })).toBeNull();
    expect(excludeReason({})).toBeNull();
  });

  it('caps a long reason', () => {
    expect(excludeReason({ [EXCLUDE_ENV]: 'x'.repeat(500) })).toHaveLength(200);
  });

  it('masks redact.env values and the home directory in the reason', () => {
    const run = buildRunFile(
      report(tests),
      context({
        env: { [EXCLUDE_ENV]: 'token s3cr3t-value leaked from /home/alice/project' },
        redact: { mode: 'extend', patterns: [], values: ['s3cr3t-value'] },
        home: '/home/alice',
      }),
    ) as HistoryRunFile;
    expect(run.run.excluded?.reason).toBe('token [redacted] leaked from ~/project');
  });
});

describe('writeRunFile', () => {
  let dir: string;
  const run = buildRunFile(report([testCase('a', 'passed', [attempt(0, 'passed')])]), context()) as HistoryRunFile;

  beforeEach(() => {
    dir = path.join(mkdtempSync(path.join(tmpdir(), 'loupe-history-')), 'loupe-history');
  });
  afterEach(() => {
    rmSync(path.dirname(dir), { recursive: true, force: true });
  });

  it('creates the folder with a .gitignore holding *, and writes runs/<name>', async () => {
    const file = await writeRunFile(dir, run);
    expect(file).toBe(path.join(dir, RUNS_FOLDER, runFileName(run.run.startedAt, streamHash(run.run.stream), run.run.id)));
    expect(readFileSync(path.join(dir, GITIGNORE), 'utf8')).toBe('*\n');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(run);
    expect(readdirSync(path.join(dir, RUNS_FOLDER))).toEqual([path.basename(file)]);
  });

  it('writes minified JSON', async () => {
    const file = await writeRunFile(dir, run);
    expect(readFileSync(file, 'utf8')).toBe(JSON.stringify(run));
  });

  it('leaves an existing folder alone: a removed .gitignore is not written again', async () => {
    mkdirSync(dir, { recursive: true });
    await writeRunFile(dir, run);
    expect(readdirSync(dir)).toEqual([RUNS_FOLDER]);
  });

  it('never replaces a .gitignore of the project', async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, GITIGNORE), '!keep\n');
    await ensureHistoryFolder(dir);
    expect(readFileSync(path.join(dir, GITIGNORE), 'utf8')).toBe('!keep\n');
  });

  it('writing the same run again replaces its file', async () => {
    await writeRunFile(dir, run);
    const changed = { ...run, run: { ...run.run, durationMs: 99 } };
    const file = await writeRunFile(dir, changed);
    expect(readdirSync(path.join(dir, RUNS_FOLDER))).toHaveLength(1);
    expect(JSON.parse(readFileSync(file, 'utf8')).run.durationMs).toBe(99);
  });

  it('a failed rename throws and leaves no temporary file', async () => {
    // A folder in the way of the target: the rename fails on every platform.
    mkdirSync(path.join(dir, RUNS_FOLDER, runFileName(run.run.startedAt, streamHash(run.run.stream), run.run.id), 'x'), { recursive: true });
    await expect(writeRunFile(dir, run)).rejects.toThrow();
    expect(readdirSync(path.join(dir, RUNS_FOLDER))).toEqual([runFileName(run.run.startedAt, streamHash(run.run.stream), run.run.id)]);
  });
});
