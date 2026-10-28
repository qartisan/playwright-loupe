import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sanitizeRemote } from '../src/core/metadata.js';
import type { LoupeReport } from '../src/schema/v1.js';
import { ROOT, assertBuilt, playwright, readReport } from './helpers/fixtures.js';
import { schemaErrors } from './helpers/schema.js';

const GIT_CONFIG = 'fixtures/git.config.ts';
/** A commit that is not the local HEAD. */
const OTHER_COMMIT = '0123456789abcdef0123456789abcdef01234567';

/**
 * Emptied so the CI running this suite gives no git value: Playwright's CI info
 * (GitHub Actions, GitLab, Jenkins) and Loupe's CI variables both read them.
 */
const CI_GIT_VARIABLES = [
  'GITHUB_ACTIONS', 'GITHUB_SHA', 'GITHUB_HEAD_REF', 'GITHUB_REF_NAME', 'GITHUB_REF_TYPE', 'GITHUB_SERVER_URL', 'GITHUB_REPOSITORY',
  'GITLAB_CI', 'CI_COMMIT_SHA', 'CI_COMMIT_BRANCH', 'CI_MERGE_REQUEST_SOURCE_BRANCH_NAME', 'CI_PROJECT_URL',
  'BUILD_SOURCEVERSION', 'BUILD_SOURCEBRANCHNAME', 'BUILD_REPOSITORY_URI',
  'CIRCLE_SHA1', 'CIRCLE_BRANCH', 'CIRCLE_REPOSITORY_URL',
  'JENKINS_URL', 'GIT_COMMIT', 'GIT_BRANCH', 'GIT_URL',
  'BITBUCKET_COMMIT', 'BITBUCKET_BRANCH', 'BITBUCKET_GIT_HTTP_ORIGIN',
  'BUILDKITE_COMMIT', 'BUILDKITE_BRANCH', 'BUILDKITE_REPO',
];
const NO_CI = Object.fromEntries(CI_GIT_VARIABLES.map((name) => [name, '']));
const NOTHING = { commit: null, branch: null, remote: null };

/** Output of a git command in this repository, null when it fails. */
function gitOutput(...args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

describe('sources of run.git in a real run', () => {
  let workDir: string;
  /** What Loupe's own reads should find in this checkout (all null outside a repository). */
  let local: LoupeReport['run']['git'];

  /** Runs the git fixture suite (or lists it) and returns its report; every report must validate against the schema. */
  function run(name: string, env: Record<string, string>, list = false): LoupeReport {
    const outputFolder = path.join(workDir, name);
    const result = playwright(['test', '--config', GIT_CONFIG, ...(list ? ['--list'] : [])], {
      ...NO_CI,
      ...env,
      LOUPE_FIXTURE_OUTPUT: outputFolder,
    });
    const report = readReport(outputFolder, `Exit code ${result.status}.\n${result.output}`);
    expect(result.status).toBe(0);
    expect(schemaErrors(report)).toEqual([]);
    return report;
  }

  beforeAll(() => {
    assertBuilt();
    workDir = mkdtempSync(path.join(tmpdir(), 'loupe-git-run-'));
    const ref = gitOutput('symbolic-ref', '--quiet', 'HEAD');
    const remote = gitOutput('config', '--get', 'remote.origin.url');
    local = {
      commit: gitOutput('rev-parse', '--verify', 'HEAD'),
      branch: ref?.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : null,
      remote: remote === null ? null : sanitizeRemote(remote),
    };
  });

  afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it('reads commit, branch and remote from the local repository by default', () => {
    expect(run('default', {}).run.git).toEqual(local);
  }, 120_000);

  it("keeps Playwright's metadata first, and takes nothing local when HEAD is another commit", () => {
    expect(run('other-commit', { LOUPE_FIXTURE_GIT_COMMIT: OTHER_COMMIT }).run.git).toEqual({ ...NOTHING, commit: OTHER_COMMIT });
  }, 120_000);

  it('LOUPE_GIT_LOCAL=0 with a commit in the metadata: the commit stays, branch and remote are null', () => {
    const report = run('off-metadata', { LOUPE_GIT_LOCAL: '0', LOUPE_FIXTURE_GIT_COMMIT: OTHER_COMMIT });
    expect(report.run.git).toEqual({ ...NOTHING, commit: OTHER_COMMIT });
  }, 120_000);

  it("LOUPE_GIT_LOCAL=0 with Playwright's captureGitInfo: its commit and branch stay, the remote is null", () => {
    const report = run('off-capture', { LOUPE_GIT_LOCAL: '0', LOUPE_FIXTURE_CAPTURE_GIT: 'commit' });
    // Playwright reads the branch itself; Loupe ignores its "HEAD" on a detached checkout.
    expect(report.run.git).toEqual({ ...local, remote: null });
  }, 120_000);

  it('LOUPE_GIT_LOCAL=0 with captureGitInfo off: nothing is recorded', () => {
    expect(run('off', { LOUPE_GIT_LOCAL: '0' }).run.git).toEqual(NOTHING);
  }, 120_000);

  it.each([
    ['1', true],
    ['true', true],
    ['0', false],
    ['false', false],
  ])('accepts LOUPE_GIT_LOCAL=%s', (value, reads) => {
    expect(run(`list-${value}`, { LOUPE_GIT_LOCAL: value }, true).run.git).toEqual(reads ? local : NOTHING);
  }, 120_000);

  // `merge-reports` is detected through Playwright's internal `_mode` reporter
  // option: without it, a merged report would take this checkout's HEAD.
  it('takes no local commit in a report written by merge-reports', (context) => {
    if (local.commit === null) context.skip('not in a git checkout: a local commit could not show');
    const blobFolder = path.join(workDir, 'blob');
    const blob = playwright(['test', '--config', GIT_CONFIG, '--reporter', 'blob'], { ...NO_CI, PLAYWRIGHT_BLOB_OUTPUT_DIR: blobFolder });
    const zips = existsSync(blobFolder) ? readdirSync(blobFolder).filter((file) => file.endsWith('.zip')) : [];
    if (zips.length === 0) throw new Error(`No blob produced (exit code ${blob.status}).\n${blob.output}`);
    const blobs = path.join(workDir, 'blobs');
    mkdirSync(blobs);
    for (const zip of zips) copyFileSync(path.join(blobFolder, zip), path.join(blobs, zip));

    const outputFolder = path.join(workDir, 'merged');
    const merge = playwright(['merge-reports', '--config', GIT_CONFIG, blobs], { ...NO_CI, LOUPE_FIXTURE_OUTPUT: outputFolder });
    const report = readReport(outputFolder, `merge-reports exit code ${merge.status}.\n${merge.output}`);
    expect(merge.status, merge.output).toBe(0);
    expect(schemaErrors(report)).toEqual([]);
    expect(report.run.git).toEqual(NOTHING);
  }, 120_000);

  it('stops the run on any other LOUPE_GIT_LOCAL value', () => {
    const outputFolder = path.join(workDir, 'invalid');
    const result = playwright(['test', '--config', GIT_CONFIG, '--list'], { LOUPE_GIT_LOCAL: 'yes', LOUPE_FIXTURE_OUTPUT: outputFolder });
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('Loupe: invalid configuration.');
    expect(result.output).toContain('LOUPE_GIT_LOCAL must be one of "true", "false", "1", "0", got "yes"');
    expect(existsSync(outputFolder)).toBe(false);
  }, 120_000);
});
