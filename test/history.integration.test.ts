import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runFileName, streamHash } from '../src/core/history/runFile.js';
import type { EmbeddedHistory, HistoryRunFile } from '../src/schema/history-v1.js';
import { daysAgo, makeRunFile, putRunFile } from './helpers/history.js';
import { ROOT, assertBuilt, playwright, readReport } from './helpers/fixtures.js';

const CONFIG = 'fixtures/history.config.ts';
const CLI = path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');

/** The CI markers of `detectCi`: they decide the origin and the run id. */
const CI_MARKERS = ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'TF_BUILD', 'CIRCLECI', 'JENKINS_URL', 'BITBUCKET_BUILD_NUMBER', 'BUILDKITE', 'TRAVIS'];
/**
 * The commit and branch variables of `detectGit` (docs/schema/v1.md, "Git and
 * CI detection"). They are read without their provider's marker, so this
 * repository's own CI (GITHUB_SHA) would put its commit in the snapshot.
 */
const GIT_VARIABLES = [
  'GITHUB_SHA',
  'GITHUB_HEAD_REF',
  'GITHUB_REF_NAME',
  'GITHUB_REF_TYPE',
  'CI_COMMIT_SHA',
  'CI_COMMIT_BRANCH',
  'CI_MERGE_REQUEST_SOURCE_BRANCH_NAME',
  'BUILD_SOURCEVERSION',
  'BUILD_SOURCEBRANCHNAME',
  'CIRCLE_SHA1',
  'CIRCLE_BRANCH',
  'GIT_COMMIT',
  'GIT_BRANCH',
  'BITBUCKET_COMMIT',
  'BITBUCKET_BRANCH',
  'BUILDKITE_COMMIT',
  'BUILDKITE_BRANCH',
  'TRAVIS_COMMIT',
  'TRAVIS_BRANCH',
  'TRAVIS_PULL_REQUEST_BRANCH',
];

/**
 * Blank, so a run in this repository's CI is a local run without git
 * information unless a test sets them. LOUPE_GIT_LOCAL keeps the commit and
 * branch of this checkout out of the snapshot.
 */
const LOCAL: Record<string, string> = {
  ...Object.fromEntries([...CI_MARKERS, ...GIT_VARIABLES].map((name) => [name, ''])),
  PWTEST_WATCH: '',
  LOUPE_ENV: '',
  LOUPE_EXCLUDE: '',
  LOUPE_GIT_LOCAL: '0',
};

let workDir: string;
/** A new history folder and report folder for one case. */
function folders(name: string): { history: string; report: string; env: Record<string, string> } {
  const history = path.join(workDir, name, 'loupe-history');
  const report = path.join(workDir, name, 'report');
  return { history, report, env: { ...LOCAL, LOUPE_HISTORY: 'on', LOUPE_HISTORY_DIR: history, LOUPE_FIXTURE_OUTPUT: report } };
}

function runFiles(history: string): string[] {
  const runs = path.join(history, 'runs');
  return existsSync(runs) ? readdirSync(runs).sort() : [];
}

function readRun(history: string, name: string): HistoryRunFile {
  return JSON.parse(readFileSync(path.join(history, 'runs', name), 'utf8')) as HistoryRunFile;
}

/** The embedded history of a report folder's index.html: null, or the block. */
function embedded(reportFolder: string): EmbeddedHistory | null {
  const html = readFileSync(path.join(reportFolder, 'index.html'), 'utf8');
  const text = /<script id="loupe-history" type="application\/json">(.*?)<\/script>/s.exec(html)?.[1];
  if (text === undefined) throw new Error('No #loupe-history block in index.html');
  return JSON.parse(text) as EmbeddedHistory | null;
}

/** What does not change between runs: no id, time, duration or version. */
function projection(run: HistoryRunFile): unknown {
  return {
    ...run,
    loupeVersion: '<version>',
    playwrightVersion: '<version>',
    run: { ...run.run, id: '<id>', reportRunId: '<report id>', startedAt: '<date>', durationMs: '<ms>' },
    tests: run.tests.map(({ d: _d, ...test }) => test),
  };
}

beforeAll(() => {
  assertBuilt();
  workDir = mkdtempSync(path.join(tmpdir(), 'loupe-history-it-'));
});

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe('history: a plain run', () => {
  let history: string;
  let output: string;
  let reportRunId: string;

  beforeAll(() => {
    const run = folders('plain');
    history = run.history;
    output = playwright(['test', '--config', CONFIG], run.env).output;
    reportRunId = readReport(run.report, output).run.id;
  }, 120_000);

  it('writes one run file and the .gitignore', () => {
    expect(readFileSync(path.join(history, '.gitignore'), 'utf8')).toBe('*\n');
    const files = runFiles(history);
    expect(files, output).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{8}T\d{6}\.\d{3}Z-[0-9a-f]{8}-[0-9a-f-]{36}\.json$/);
  });

  it('records the expected content', () => {
    const run = readRun(history, runFiles(history)[0] as string);
    expect(run.run.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(runFiles(history)[0]).toBe(runFileName(run.run.startedAt, streamHash(run.run.stream), run.run.id));
    expect(projection(run)).toMatchSnapshot();
  });

  it("links to its report: report.json's run.id", () => {
    const run = readRun(history, runFiles(history)[0] as string);
    expect(run.run.reportRunId).toBe(reportRunId);
  });

  it('prints no history warning', () => {
    expect(output).not.toContain('Loupe: history');
  });

  it('embeds no history on a first run', () => {
    expect(embedded(path.join(workDir, 'plain', 'report'))).toBeNull();
  });
});

describe('history: the embedded window', () => {
  it('the next run embeds the run before it, never itself', () => {
    const run = folders('embed');
    const first = readReport(run.report, playwright(['test', '--config', CONFIG], run.env).output);
    const [firstFile] = runFiles(run.history);
    const result = playwright(['test', '--config', CONFIG], run.env);
    const second = readReport(run.report, result.output);
    expect(result.output).not.toContain('Loupe: history');
    const value = embedded(run.report);
    expect(value?.runs.map((entry) => [entry.id, entry.reportRunId])).toEqual([[readRun(run.history, firstFile as string).run.id, first.run.id]]);
    expect(value?.stream).toEqual(fixtureStream());
    // One status per test of this report, for its one past run.
    expect(value?.cells).toBe(second.tests.map((test) => ({ passed: 'P', failed: 'F', flaky: 'K', skipped: 'S' })[test.outcome]).join(''));
    expect(value?.failures.length).toBeGreaterThan(0);
  }, 120_000);
});

describe('history: runs that are never written', () => {
  it('history off writes nothing, and the report is written', () => {
    const run = folders('off');
    const result = playwright(['test', '--config', CONFIG], { ...run.env, LOUPE_HISTORY: 'off' });
    readReport(run.report, result.output);
    expect(existsSync(run.history)).toBe(false);
    expect(embedded(run.report)).toBeNull();
  }, 120_000);

  it('--list writes nothing', () => {
    const run = folders('list');
    const result = playwright(['test', '--config', CONFIG, '--list'], run.env);
    readReport(run.report, result.output);
    expect(existsSync(run.history)).toBe(false);
  }, 120_000);

  it('a run where no test ran (an empty shard) writes nothing', () => {
    const run = folders('empty');
    // One file, not fully parallel: shard 2/2 gets no test.
    const result = playwright(['test', '--config', CONFIG, '--shard', '2/2'], run.env);
    const report = readReport(run.report, result.output);
    expect(report.tests.some((test) => test.attempts.length > 0)).toBe(false);
    expect(existsSync(run.history)).toBe(false);
  }, 120_000);
});

describe('history: blobs and merge-reports', () => {
  let history: string;
  let blobs: string;
  const merge = (env: Record<string, string> = {}) =>
    playwright(['merge-reports', '--reporter', path.join(ROOT, 'dist', 'index.js'), blobs], {
      ...LOCAL,
      LOUPE_HISTORY: 'on',
      LOUPE_HISTORY_DIR: history,
      LOUPE_OUTPUT_FOLDER: path.join(workDir, 'merge', 'merged'),
      ...env,
    });
  /** Runs the suite with the blob reporter next to Loupe, into `blobs`. */
  const shardRun = (name: string) => {
    blobs = path.join(workDir, 'merge', name);
    const run = folders(`merge-${name}`);
    const result = playwright(['test', '--config', CONFIG], { ...run.env, LOUPE_HISTORY_DIR: history, LOUPE_FIXTURE_BLOB: blobs });
    readReport(run.report, result.output);
    if (!existsSync(blobs) || readdirSync(blobs).length === 0) throw new Error(`No blob written.\n${result.output}`);
  };

  beforeAll(() => {
    history = path.join(workDir, 'merge', 'loupe-history');
    shardRun('blobs-1');
  }, 120_000);

  it('a run that writes a blob does not write history', () => {
    expect(existsSync(history)).toBe(false);
  });

  it('merge-reports writes the run, as merge-<hash> outside CI, and a re-merge rewrites the same file', () => {
    const first = merge();
    expect(first.output).not.toContain('Loupe: history');
    const files = runFiles(history);
    expect(files, first.output).toHaveLength(1);
    expect(files[0]).toMatch(/-merge-[0-9a-f]{8}\.json$/);
    const run = readRun(history, files[0] as string);
    expect([run.run.merged, run.run.origin]).toEqual([true, 'local']);
    expect(run.tests).toHaveLength(5);

    // Its own earlier file is not its past: nothing else to embed.
    merge();
    expect(runFiles(history)).toEqual(files);
    expect(embedded(path.join(workDir, 'merge', 'merged'))).toBeNull();
  }, 120_000);

  it('in CI, a re-run of the merge job alone rewrites the same file', () => {
    rmSync(history, { recursive: true, force: true });
    const ci = { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '4242', GITHUB_RUN_ATTEMPT: '1' };
    merge(ci);
    const files = runFiles(history);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/-github-actions-4242-[0-9a-f]{8}\.json$/);
    expect(readRun(history, files[0] as string).run.origin).toBe('ci');
    merge({ ...ci, GITHUB_RUN_ATTEMPT: '2' });
    expect(runFiles(history)).toEqual(files);
  }, 120_000);

  it('a real re-run of the tests makes a new file', () => {
    rmSync(history, { recursive: true, force: true });
    merge();
    const before = runFiles(history);
    shardRun('blobs-2');
    merge();
    const after = runFiles(history);
    expect(after).toHaveLength(2);
    expect(after).toEqual(expect.arrayContaining(before));
    expect(embedded(path.join(workDir, 'merge', 'merged'))?.runs.map((entry) => entry.id)).toEqual([readRun(history, before[0] as string).run.id]);
  }, 240_000);
});

/** The stream of a fixture run: environment from fixtures/loupe.config.ts unless LOUPE_ENV, origin local. */
const fixtureStream = (environment = 'fixtures') => ({ environment, origin: 'local' });

/** `playwright test` on the history fixture, asynchronous so that two can run at once, each with its own transform cache. */
function runAsync(env: Record<string, string>): Promise<string> {
  const cacheDir = mkdtempSync(path.join(tmpdir(), 'loupe-pw-cache-'));
  return new Promise<string>((resolve) => {
    const child = spawn(process.execPath, [CLI, 'test', '--config', CONFIG], { cwd: ROOT, env: { ...process.env, PWTEST_CACHE_DIR: cacheDir, ...env } });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('close', () => {
      rmSync(cacheDir, { recursive: true, force: true });
      resolve(output);
    });
  });
}

describe('history: reading the folder', () => {
  it('a corrupt file and a file of a newer Loupe in the window: one warning, the report, the run recorded, both files untouched', () => {
    const run = folders('corrupt');
    const now = Date.now();
    const corrupt = putRunFile(run.history, makeRunFile({ id: 'corrupt', startedAt: daysAgo(now, 1), stream: fixtureStream() }), '{"historyVersion":1,');
    const newer = putRunFile(run.history, makeRunFile({ id: 'newer', startedAt: daysAgo(now, 2), stream: fixtureStream() }), '{"historyVersion":2}');
    const result = playwright(['test', '--config', CONFIG], run.env);
    readReport(run.report, result.output);
    const warnings = result.output.split('\n').filter((line) => line.includes('Loupe: history'));
    expect(warnings, result.output).toEqual([
      `Loupe: history: skipped a corrupt run file: runs/${corrupt}; skipped a run file written by a newer Loupe: runs/${newer}. The report is not affected.`,
    ]);
    expect(runFiles(run.history)).toHaveLength(3);
    expect(readFileSync(path.join(run.history, 'runs', corrupt), 'utf8')).toBe('{"historyVersion":1,');
    expect(readFileSync(path.join(run.history, 'runs', newer), 'utf8')).toBe('{"historyVersion":2}');
  }, 120_000);

  it('a report that ends in another stream than the one read at the start: the window of the end stream is read', () => {
    const run = folders('late-branch');
    const now = Date.now();
    // Only the end stream's own window reaches its second run: from the start stream, it is another stream, read for its newest run only.
    const end = { ...fixtureStream(), branch: 'late' };
    putRunFile(run.history, makeRunFile({ id: 'end-newest', startedAt: daysAgo(now, 1), stream: end }));
    const corrupt = putRunFile(run.history, makeRunFile({ id: 'end-older', startedAt: daysAgo(now, 2), stream: end }), '{"historyVersion":1,');
    const result = playwright(['test', '--config', CONFIG], { ...run.env, LOUPE_FIXTURE_LATE_BRANCH: 'late' });
    readReport(run.report, result.output);
    const warnings = result.output.split('\n').filter((line) => line.includes('Loupe: history'));
    expect(warnings, result.output).toEqual([`Loupe: history: skipped a corrupt run file: runs/${corrupt}. The report is not affected.`]);
    const recorded = runFiles(run.history).filter((name) => !name.includes('-end-'));
    expect(recorded).toHaveLength(1);
    expect(readRun(run.history, recorded[0] as string).run.stream).toEqual({ environment: 'fixtures', origin: 'local', branch: 'late' });
  }, 120_000);

  it('a history folder that cannot be used: one warning, the report is written', () => {
    const run = folders('unusable');
    mkdirSync(run.history, { recursive: true });
    // A file where runs/ should be: reading and writing fail on every platform.
    writeFileSync(path.join(run.history, 'runs'), '');
    const result = playwright(['test', '--config', CONFIG], run.env);
    readReport(run.report, result.output);
    const warnings = result.output.split('\n').filter((line) => line.includes('Loupe: history'));
    expect(warnings, result.output).toHaveLength(1);
    expect(warnings[0]).toMatch(/^Loupe: history: the history folder could not be read \(.*\); this run was not recorded \(.*\)\. The report is not affected\.$/);
  }, 120_000);
});

describe('history: retention', () => {
  it('two runs of two streams at once, on one folder: each keeps maxRuns of its own stream, a third stream keeps its runs, old runs leave every stream', async () => {
    const run = folders('retention');
    const now = Date.now();
    const seed = (environment: string, days: number[]) =>
      days.map((day) => putRunFile(run.history, makeRunFile({ id: `${environment}-${day}`, startedAt: daysAgo(now, day), stream: fixtureStream(environment) })));
    const [a1, a2] = seed('a', [1, 2, 3, 4, 5]);
    const [b1, b2] = seed('b', [1, 2, 3, 4, 5]);
    const third = seed('c', [1, 2, 3, 4, 5]);
    const [abandoned] = seed('gone', [91]);
    const env = { ...run.env, LOUPE_FIXTURE_MAX_RUNS: '3' };
    const outputs = await Promise.all([
      runAsync({ ...env, LOUPE_ENV: 'a', LOUPE_FIXTURE_OUTPUT: path.join(run.report, 'a') }),
      runAsync({ ...env, LOUPE_ENV: 'b', LOUPE_FIXTURE_OUTPUT: path.join(run.report, 'b') }),
    ]);
    for (const output of outputs) expect(output).not.toContain('Loupe: history');
    const left = runFiles(run.history);
    const ofStream = (environment: string) => left.filter((name) => name.includes(`-${streamHash(fixtureStream(environment))}-`));
    // The new run, then the two newest seeded runs.
    for (const [environment, newest] of [['a', [a1, a2]], ['b', [b1, b2]]] as const) {
      expect(ofStream(environment)).toHaveLength(3);
      expect(ofStream(environment)).toEqual(expect.arrayContaining([...newest]));
    }
    expect(ofStream('c')).toEqual([...third].sort());
    expect(left).not.toContain(abandoned);
  }, 120_000);
});

describe('history: a run in CI', () => {
  // The checkout's own commit: Playwright reads it too when it detects GitHub Actions (captureGitInfo).
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  it.each([
    ['github-actions', { GITHUB_ACTIONS: 'true', GITHUB_SHA: head, GITHUB_RUN_ID: '4242' }],
    ['azure-pipelines', { TF_BUILD: 'True', BUILD_SOURCEVERSION: head, BUILD_BUILDID: '4242' }],
  ])('%s: origin ci, the commit, and the CI run id in the run id', (provider, ci) => {
    const run = folders(`ci-${provider}`);
    const result = playwright(['test', '--config', CONFIG], { ...run.env, ...ci });
    readReport(run.report, result.output);
    const files = runFiles(run.history);
    expect(files, result.output).toHaveLength(1);
    const recorded = readRun(run.history, files[0] as string);
    expect(recorded.run.id).toMatch(new RegExp(`^${provider}-4242-[0-9a-f]{8}$`));
    expect([recorded.run.origin, recorded.run.ciProvider, recorded.run.git.commit]).toEqual(['ci', provider, head]);
    expect(files[0]).toMatch(new RegExp(`-${provider}-4242-[0-9a-f]{8}\\.json$`));
  }, 120_000);
});

describe('history: the default folder overlapping the report folder', () => {
  it('one warning, the report is written, no history', () => {
    const dir = path.join(workDir, 'overlap');
    mkdirSync(dir);
    // The config sits in the report folder (outputFolder '.'), so the default loupe-history is inside it.
    const config = path.join(dir, 'playwright.config.mjs');
    writeFileSync(
      config,
      `export default ${JSON.stringify({
        testDir: path.join(ROOT, 'fixtures', 'history'),
        reporter: [[path.join(ROOT, 'dist', 'index.js'), { outputFolder: '.' }]],
        projects: [{ name: 'history' }],
      })};\n`,
    );
    // history.dir is not set, and an empty LOUPE_HISTORY leaves the default: on.
    const result = playwright(['test', '--config', config, '--output', path.join(workDir, 'overlap-results')], { ...LOCAL, LOUPE_HISTORY: '', LOUPE_HISTORY_DIR: '' });
    readReport(dir, result.output);
    expect(result.output.match(/Loupe: history is off for this run/g), result.output).toHaveLength(1);
    expect(existsSync(path.join(dir, 'loupe-history'))).toBe(false);
  }, 120_000);
});

describe('history: origin of a run from the VS Code extension', () => {
  it('a test-server run (what the extension starts) is recorded as ide', async () => {
    const run = folders('ide');
    const cacheDir = mkdtempSync(path.join(tmpdir(), 'loupe-pw-cache-'));
    const child = spawn(process.execPath, [CLI, 'test-server', '-c', CONFIG, '--host', '127.0.0.1'], {
      cwd: ROOT,
      env: { ...process.env, PWTEST_CACHE_DIR: cacheDir, ...run.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    try {
      const url = await new Promise<string>((resolve, reject) => {
        child.stdout.on('data', (chunk: Buffer) => {
          output += chunk.toString();
          const match = /Listening on (ws:\/\/\S+)/.exec(output);
          if (match) resolve(match[1] as string);
        });
        child.on('exit', () => reject(new Error(`test-server exited.\n${output}`)));
      });
      const socket = new WebSocket(url);
      await new Promise((resolve) => socket.addEventListener('open', resolve));
      let id = 0;
      const pending = new Map<number, (message: unknown) => void>();
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data)) as { id?: number };
        if (message.id !== undefined) pending.get(message.id)?.(message);
      });
      const call = (method: string, params: unknown) =>
        new Promise((resolve) => {
          pending.set(++id, resolve);
          socket.send(JSON.stringify({ id, method, params }));
        });
      await call('initialize', { closeOnDisconnect: true });
      await call('runTests', { locations: [] });
      socket.close();
    } finally {
      child.kill();
      rmSync(cacheDir, { recursive: true, force: true });
    }
    const files = runFiles(run.history);
    expect(files, output).toHaveLength(1);
    const recorded = readRun(run.history, files[0] as string);
    expect([recorded.run.origin, recorded.run.stream]).toEqual(['ide', { environment: 'fixtures', origin: 'ide' }]);
  }, 120_000);
});
