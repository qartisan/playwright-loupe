import { describe, expect, it } from 'vitest';
import { detectCi, detectEnvironment, detectGit, sanitizeRemote } from '../src/core/metadata.js';

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

describe('detectGit: local repository', () => {
  const HEAD = '4fe7a5e1c2d3b4a5968778695a4b3c2d1e0f9a8b';
  const LOCAL = { commit: HEAD, branch: 'feature/local', remote: 'git@github.com:org/repo.git' };
  const local = (merged = false, git: typeof LOCAL | { commit: null; branch: null; remote: null } = LOCAL) => ({ git, merged });

  it('fills every field from the local repository when nothing else is known', () => {
    expect(detectGit({}, {}, local())).toEqual(LOCAL);
  });

  it('keeps every CI value over the local ones', () => {
    expect(detectGit({}, GITLAB, local())).toEqual({ commit: 'gl-sha', branch: 'develop', remote: 'https://gitlab.com/group/project' });
  });

  it("keeps Playwright's captured info over the local ones", () => {
    const metadata = { gitCommit: { hash: HEAD, branch: 'captured' } };
    expect(detectGit(metadata, {}, local())).toEqual({ ...LOCAL, branch: 'captured' });
  });

  it('completes a CI commit with the local branch and remote when HEAD is that commit', () => {
    expect(detectGit({}, { GIT_COMMIT: HEAD }, local())).toEqual(LOCAL);
  });

  it('matches an abbreviated CI commit by prefix, ignoring case', () => {
    expect(detectGit({}, { GIT_COMMIT: '4FE7A5E' }, local())).toEqual({ ...LOCAL, commit: '4FE7A5E' });
  });

  it('completes only the missing fields', () => {
    expect(detectGit({}, { GIT_COMMIT: HEAD, GIT_BRANCH: 'ci-branch' }, local())).toEqual({ ...LOCAL, branch: 'ci-branch' });
  });

  it('takes nothing local when HEAD is another commit than the CI one', () => {
    expect(detectGit({}, { GIT_COMMIT: 'ffffffffffffffffffffffffffffffffffffffff' }, local())).toEqual({
      commit: 'ffffffffffffffffffffffffffffffffffffffff',
      branch: null,
      remote: null,
    });
  });

  it('does not match a CI commit too short or not hexadecimal', () => {
    expect(detectGit({}, { GIT_COMMIT: '4fe7a5' }, local()).branch).toBeNull();
    expect(detectGit({}, { GIT_COMMIT: 'env-sha' }, local()).branch).toBeNull();
  });

  it('never takes the local commit under merge-reports', () => {
    expect(detectGit({}, {}, local(true))).toEqual({ commit: null, branch: null, remote: null });
  });

  it('completes a merged report when HEAD is the commit of the shards', () => {
    const metadata = { gitCommit: { hash: HEAD } };
    expect(detectGit(metadata, {}, local(true))).toEqual(LOCAL);
  });

  it('keeps the CI values when the local read found nothing', () => {
    const nothing = { commit: null, branch: null, remote: null };
    expect(detectGit({}, { GIT_COMMIT: HEAD }, local(false, nothing))).toEqual({ commit: HEAD, branch: null, remote: null });
    expect(detectGit({}, {}, local(false, nothing))).toEqual(nothing);
  });

  it('sanitizes a local remote that reaches it unsanitized', () => {
    const git = { ...LOCAL, remote: 'https://user:token@github.com/org/repo.git' };
    expect(detectGit({}, {}, local(false, git)).remote).toBe('https://github.com/org/repo.git');
  });
});

describe('sanitizeRemote', () => {
  it('keeps remotes without credentials unchanged', () => {
    expect(sanitizeRemote('https://github.com/a/b')).toBe('https://github.com/a/b');
    expect(sanitizeRemote('https://host')).toBe('https://host');
    expect(sanitizeRemote('git@github.com:a/b.git')).toBe('git@github.com:a/b.git');
    expect(sanitizeRemote('/srv/git/repo.git')).toBe('/srv/git/repo.git');
    expect(sanitizeRemote('file:///srv/git/repo.git')).toBe('file:///srv/git/repo.git');
  });

  it('removes credentials from URLs', () => {
    expect(sanitizeRemote('https://user:token@github.com/o/r.git')).toBe('https://github.com/o/r.git');
    expect(sanitizeRemote('https://x-access-token:ghp_abc@github.com/o/r')).toBe('https://github.com/o/r');
    expect(sanitizeRemote('HTTPS://u:t@host/r')).toBe('https://host/r');
    expect(sanitizeRemote('https://u%40mail:t%2F@host/r')).toBe('https://host/r');
    expect(sanitizeRemote('ssh://git:pw@host:22/r')).toBe('ssh://host:22/r');
  });

  it('ends the credentials at the last @, as browsers and git do', () => {
    // Versions up to 0.0.6 stopped at the first @ and kept `ss@`.
    expect(sanitizeRemote('https://user:p@ss@github.com/o/r.git')).toBe('https://github.com/o/r.git');
  });

  it('removes the query and the fragment', () => {
    expect(sanitizeRemote('https://host/r.git?access_token=secret')).toBe('https://host/r.git');
    expect(sanitizeRemote('https://host/r.git#token=secret')).toBe('https://host/r.git');
    expect(sanitizeRemote('https://u:t@host/r.git?private_token=x#y')).toBe('https://host/r.git');
  });

  it('drops a remote with an @ that cannot be parsed', () => {
    // A raw `/` in the password: no URL parser agrees on where the host starts.
    expect(sanitizeRemote('https://user:to/ken@host/r')).toBeNull();
    // Without a scheme, only the scp-like form is kept, and only with a user name without `:`.
    expect(sanitizeRemote('user:token@host:o/r.git')).toBeNull();
    expect(sanitizeRemote('user:token@host/o/r.git')).toBeNull();
    expect(sanitizeRemote('git@host:o/r@x.git')).toBeNull();
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
