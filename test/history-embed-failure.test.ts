import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FullConfig, FullResult, Suite } from '@playwright/test/reporter';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertBuilt } from './helpers/fixtures.js';
import { daysAgo, makeRunFile, putRunFile } from './helpers/history.js';

// The shipped reporter, with a derivation that throws: no real data makes it fail.
vi.mock('../dist/core/history/embed.js', () => ({
  deriveEmbedded: () => {
    throw new Error('derivation broke');
  },
}));

/** Variables that would change the stream, the git data or the run id: blank, so the result is the same locally and in CI. */
const HERMETIC = ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'TF_BUILD', 'CIRCLECI', 'JENKINS_URL', 'BITBUCKET_BUILD_NUMBER', 'BUILDKITE', 'TRAVIS', 'PWTEST_WATCH', 'LOUPE_ENV', 'LOUPE_EXCLUDE'];

/** What the reporter reads of a Playwright config, for a run of no test. */
function config(rootDir: string): FullConfig {
  return {
    rootDir,
    configFile: path.join(rootDir, 'playwright.config.ts'),
    version: '1.64.0',
    metadata: {},
    workers: 1,
    shard: null,
    grep: /.*/,
    grepInvert: null,
    projects: [],
    reporter: [],
  } as unknown as FullConfig;
}
const suite = { allTests: () => [], suites: [] } as unknown as Suite;
const result = { status: 'passed', startTime: new Date('2026-11-11T10:00:00.000Z'), duration: 5 } as FullResult;

describe('history: a derivation that fails', () => {
  let root: string | undefined;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('writes the report with a null block and one "Loupe: history" warning', async () => {
    assertBuilt();
    root = mkdtempSync(path.join(tmpdir(), 'loupe-embed-failure-'));
    const history = path.join(root, 'loupe-history');
    const output = path.join(root, 'report');
    for (const name of HERMETIC) vi.stubEnv(name, '');
    vi.stubEnv('LOUPE_HISTORY', 'on');
    vi.stubEnv('LOUPE_HISTORY_DIR', history);
    vi.stubEnv('LOUPE_GIT_LOCAL', '0');
    // A past run in the stream of this run, so there is something to derive.
    putRunFile(history, makeRunFile({ id: 'past', startedAt: daysAgo(Date.now(), 1), stream: { environment: 'default', origin: 'local' } }));
    const warnings: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((message: unknown) => void warnings.push(String(message)));
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const { LoupeReporter } = await import('../dist/core/reporter.js');
    const reporter = new LoupeReporter({ outputFolder: output });
    reporter.onBegin(config(root), suite);
    await reporter.onEnd(result);

    expect(existsSync(path.join(output, 'report.json'))).toBe(true);
    const html = readFileSync(path.join(output, 'index.html'), 'utf8');
    expect(/<script id="loupe-history" type="application\/json">(.*?)<\/script>/s.exec(html)?.[1]).toBe('null');
    expect(warnings.filter((message) => message.includes('Loupe: history'))).toEqual([
      'Loupe: history: the history could not be embedded (derivation broke). The report is not affected.',
    ]);
    // The past run is still there, untouched.
    expect(readdirSync(path.join(history, 'runs'))).toHaveLength(1);
  });
});
