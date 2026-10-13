import { describe, expect, it } from 'vitest';
import { detectCi, detectEnvironment, detectGit, stripCredentials } from '../src/core/metadata.js';

const GITHUB = {
  GITHUB_ACTIONS: 'true',
  CI: 'true',
  GITHUB_SHA: 'env-sha',
  GITHUB_REF_TYPE: 'branch',
  GITHUB_REF_NAME: 'main',
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_REPOSITORY: 'qartisan/playwright-loupe',
};

const GITLAB = {
  GITLAB_CI: 'true',
  CI: 'true',
  CI_COMMIT_SHA: 'gl-sha',
  CI_COMMIT_BRANCH: 'develop',
  CI_PROJECT_URL: 'https://gitlab.com/group/project',
};

describe('detectCi', () => {
  it('detects GitHub Actions and GitLab CI', () => {
    expect(detectCi(GITHUB)).toEqual({ ci: true, ciProvider: 'github-actions' });
    expect(detectCi(GITLAB)).toEqual({ ci: true, ciProvider: 'gitlab' });
  });

  it('detects a generic CI from the CI variable', () => {
    expect(detectCi({ CI: 'true' })).toEqual({ ci: true, ciProvider: null });
    expect(detectCi({ CI: '1' })).toEqual({ ci: true, ciProvider: null });
  });

  it('is false locally or when CI is explicitly off', () => {
    expect(detectCi({})).toEqual({ ci: false, ciProvider: null });
    expect(detectCi({ CI: 'false' })).toEqual({ ci: false, ciProvider: null });
    expect(detectCi({ CI: '0' })).toEqual({ ci: false, ciProvider: null });
  });
});

describe('detectGit', () => {
  it('is all null when nothing is known', () => {
    expect(detectGit({}, {})).toEqual({ commit: null, branch: null, remote: null });
  });

  it("prefers Playwright's captured git info", () => {
    const metadata = { gitCommit: { hash: 'pw-sha', branch: 'feature/x' } };
    expect(detectGit(metadata, GITHUB)).toEqual({
      commit: 'pw-sha',
      branch: 'feature/x',
      remote: 'https://github.com/qartisan/playwright-loupe',
    });
  });

  it("uses Playwright's CI info when there is no commit info", () => {
    const metadata = { ci: { commitHash: 'ci-sha', branch: 'release' } };
    expect(detectGit(metadata, {})).toEqual({ commit: 'ci-sha', branch: 'release', remote: null });
  });

  it('ignores a detached HEAD branch name', () => {
    const metadata = { gitCommit: { hash: 'pw-sha', branch: 'HEAD' } };
    expect(detectGit(metadata, GITHUB).branch).toBe('main');
  });

  it('falls back to GitHub Actions variables', () => {
    expect(detectGit({}, GITHUB)).toEqual({
      commit: 'env-sha',
      branch: 'main',
      remote: 'https://github.com/qartisan/playwright-loupe',
    });
  });

  it('uses the pull request head branch on GitHub', () => {
    const env = { ...GITHUB, GITHUB_HEAD_REF: 'fix/login', GITHUB_REF_NAME: '42/merge' };
    expect(detectGit({}, env).branch).toBe('fix/login');
  });

  it('does not report a tag as a branch on GitHub', () => {
    const env = { ...GITHUB, GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v1.0.0' };
    expect(detectGit({}, env).branch).toBeNull();
  });

  it('falls back to GitLab CI variables', () => {
    expect(detectGit({}, GITLAB)).toEqual({ commit: 'gl-sha', branch: 'develop', remote: 'https://gitlab.com/group/project' });
  });

  it('uses the merge request source branch on GitLab', () => {
    const env = { ...GITLAB, CI_COMMIT_BRANCH: undefined, CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: 'mr-branch' };
    expect(detectGit({}, env).branch).toBe('mr-branch');
  });

  it('ignores malformed metadata', () => {
    expect(detectGit({ gitCommit: 'oops', ci: { commitHash: 42 } }, {})).toEqual({
      commit: null,
      branch: null,
      remote: null,
    });
  });

  it('removes credentials from remotes', () => {
    expect(detectGit({}, { GIT_URL: 'https://user:token@git.example.com/repo.git' }).remote).toBe(
      'https://git.example.com/repo.git',
    );
  });
});

describe('stripCredentials', () => {
  it('keeps remotes without credentials unchanged', () => {
    expect(stripCredentials('https://github.com/a/b')).toBe('https://github.com/a/b');
    expect(stripCredentials('git@github.com:a/b.git')).toBe('git@github.com:a/b.git');
  });
});

describe('detectEnvironment', () => {
  it('uses the configured name and formats the OS', () => {
    expect(detectEnvironment({}, 'staging', 'linux', 'x64', 'v22.0.0')).toEqual({
      name: 'staging',
      ci: false,
      ciProvider: null,
      os: 'linux-x64',
      nodeVersion: 'v22.0.0',
    });
  });

  it('treats an empty name as unknown', () => {
    expect(detectEnvironment({}, ' ', 'darwin', 'arm64', 'v24.0.0').name).toBeNull();
  });
});
