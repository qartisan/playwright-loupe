import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HistoryRunFile } from '../src/schema/history-v1.js';
import { ROOT, assertBuilt, playwright, readReport } from './helpers/fixtures.js';

const CONFIG = 'fixtures/history.config.ts';
const CLI = path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');

/**
 * Variables that would change the origin or the run id: blank, so a run in
 * this repository's CI is a local run unless a test sets them. LOUPE_GIT_LOCAL
 * keeps the commit and branch of this checkout out of the snapshot.
 */
const LOCAL: Record<string, string> = {
  CI: '',
  GITHUB_ACTIONS: '',
  GITLAB_CI: '',
  TF_BUILD: '',
  CIRCLECI: '',
  JENKINS_URL: '',
  BITBUCKET_BUILD_NUMBER: '',
  BUILDKITE: '',
  TRAVIS: '',
  PWTEST_WATCH: '',
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

/** What does not change between runs: no id, time, duration or version. */
function projection(run: HistoryRunFile): unknown {
  return {
    ...run,
    loupeVersion: '<version>',
    playwrightVersion: '<version>',
    run: { ...run.run, id: '<id>', startedAt: '<date>', durationMs: '<ms>' },
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

  beforeAll(() => {
    const run = folders('plain');
    history = run.history;
    output = playwright(['test', '--config', CONFIG], run.env).output;
    readReport(run.report, output);
  }, 120_000);

  it('writes one run file and the .gitignore', () => {
    expect(readFileSync(path.join(history, '.gitignore'), 'utf8')).toBe('*\n');
    const files = runFiles(history);
    expect(files, output).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{8}T\d{6}\.\d{3}Z-[0-9a-f-]{36}\.json$/);
  });

  it('records the expected content', () => {
    const run = readRun(history, runFiles(history)[0] as string);
    expect(run.run.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(runFiles(history)[0]).toBe(`${run.run.startedAt.replace(/[-:]/g, '')}-${run.run.id}.json`);
    expect(projection(run)).toMatchSnapshot();
  });

  it('prints no history warning', () => {
    expect(output).not.toContain('Loupe: history');
  });
});

describe('history: runs that are never written', () => {
  it('history off writes nothing, and the report is written', () => {
    const run = folders('off');
    const result = playwright(['test', '--config', CONFIG], { ...run.env, LOUPE_HISTORY: 'off' });
    readReport(run.report, result.output);
    expect(existsSync(run.history)).toBe(false);
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

    merge();
    expect(runFiles(history)).toEqual(files);
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
  }, 240_000);
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
