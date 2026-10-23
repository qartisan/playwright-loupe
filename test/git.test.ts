import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readLocalGit } from '../src/core/git.js';

const WINDOWS = process.platform === 'win32';

let workDir: string;
/** Git isolated from the user's and the system's config, and from any repository above `workDir`. */
let env: Record<string, string | undefined>;

/** Runs git in a test repository, with a fixed identity for commits. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=Loupe Test', '-c', 'user.email=test@example.com', ...args], {
    cwd,
    env,
    encoding: 'utf8',
  }).trim();
}

/** A new repository with one commit on `main`. */
function repo(name: string): { dir: string; head: string } {
  const dir = path.join(workDir, name);
  mkdirSync(dir);
  git(dir, 'init', '--quiet', '--initial-branch=main');
  git(dir, 'commit', '--quiet', '--allow-empty', '-m', 'first');
  return { dir, head: git(dir, 'rev-parse', 'HEAD') };
}

/** A folder holding a fake `git` script, to put alone on PATH. */
function fakeGit(name: string, script: string): string {
  const dir = path.join(workDir, name);
  mkdirSync(dir);
  const file = path.join(dir, 'git');
  writeFileSync(file, `#!/bin/sh\n${script}\n`);
  chmodSync(file, 0o755);
  return dir;
}

const read = (cwd: string, overrides: Record<string, string | undefined> = {}, timeoutMs = 2000) =>
  readLocalGit({ cwd, env: { ...env, ...overrides }, timeoutMs });

beforeAll(() => {
  workDir = mkdtempSync(path.join(tmpdir(), 'loupe-git-'));
  env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: WINDOWS ? 'NUL' : '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CEILING_DIRECTORIES: workDir,
  };
  // Variables a git hook or a CI step may set would point git elsewhere.
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete env[name];
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('readLocalGit', () => {
  it('reads the commit, the branch and the remote', async () => {
    const { dir, head } = repo('normal');
    git(dir, 'checkout', '--quiet', '-b', 'feature/local-git');
    git(dir, 'remote', 'add', 'origin', 'git@github.com:org/repo.git');
    expect(await read(dir)).toEqual({ commit: head, branch: 'feature/local-git', remote: 'git@github.com:org/repo.git' });
  });

  it('reads the repository from a subfolder (monorepo package)', async () => {
    const { dir, head } = repo('monorepo');
    const pkg = path.join(dir, 'packages', 'e2e');
    mkdirSync(pkg, { recursive: true });
    expect(await read(pkg)).toEqual({ commit: head, branch: 'main', remote: null });
  });

  it('has no branch on a detached HEAD', async () => {
    const { dir, head } = repo('detached');
    git(dir, 'checkout', '--quiet', '--detach');
    expect(await read(dir)).toEqual({ commit: head, branch: null, remote: null });
  });

  it('keeps the full branch name when a tag has the same name', async () => {
    const { dir } = repo('ambiguous');
    git(dir, 'tag', 'main');
    expect((await read(dir)).branch).toBe('main');
  });

  it('has no remote without an origin', async () => {
    const { dir, head } = repo('no-remote');
    git(dir, 'remote', 'add', 'upstream', 'https://github.com/org/upstream.git');
    expect(await read(dir)).toEqual({ commit: head, branch: 'main', remote: null });
  });

  it('removes credentials from the remote', async () => {
    const { dir } = repo('credentials');
    git(dir, 'remote', 'add', 'origin', 'https://user:ghp_secret@github.com/org/repo.git?token=x');
    expect((await read(dir)).remote).toBe('https://github.com/org/repo.git');
  });

  it('drops a remote that cannot be sanitized', async () => {
    const { dir, head } = repo('unsafe-remote');
    git(dir, 'remote', 'add', 'origin', 'user:token@host:org/repo.git');
    expect(await read(dir)).toEqual({ commit: head, branch: 'main', remote: null });
  });

  it('has no commit in a repository without commits', async () => {
    const dir = path.join(workDir, 'empty');
    mkdirSync(dir);
    git(dir, 'init', '--quiet', '--initial-branch=main');
    expect(await read(dir)).toEqual({ commit: null, branch: 'main', remote: null });
  });

  it('is all null outside a repository', async () => {
    const dir = path.join(workDir, 'not-a-repo');
    mkdirSync(dir);
    expect(await read(dir)).toEqual({ commit: null, branch: null, remote: null });
  });

  it('is all null when the folder does not exist', async () => {
    expect(await read(path.join(workDir, 'missing'))).toEqual({ commit: null, branch: null, remote: null });
  });

  it('is all null when git is not installed', async () => {
    const { dir } = repo('no-git');
    const emptyPath = path.join(workDir, 'empty-path');
    mkdirSync(emptyPath);
    expect(await read(dir, { PATH: emptyPath, Path: emptyPath })).toEqual({ commit: null, branch: null, remote: null });
  });

  it.skipIf(WINDOWS)('is all null on dubious ownership (exit 128)', async () => {
    const bin = fakeGit('dubious', "echo \"fatal: detected dubious ownership in repository at '$PWD'\" >&2\nexit 128");
    expect(await read(workDir, { PATH: bin })).toEqual({ commit: null, branch: null, remote: null });
  });

  it.skipIf(WINDOWS)('is all null when git does not answer in time', async () => {
    const bin = fakeGit('slow', 'exec sleep 10');
    const started = Date.now();
    expect(await read(workDir, { PATH: bin }, 200)).toEqual({ commit: null, branch: null, remote: null });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it.skipIf(WINDOWS)('ignores unexpected output', async () => {
    const bin = fakeGit('garbage', 'echo "not a hash"');
    expect(await read(workDir, { PATH: bin })).toEqual({ commit: null, branch: null, remote: 'not a hash' });
    const multiline = fakeGit('multiline', 'printf "a\\nb\\n"');
    expect(await read(workDir, { PATH: multiline })).toEqual({ commit: null, branch: null, remote: null });
  });

  it.skipIf(WINDOWS)('runs read-only commands only, without locks or prompts', async () => {
    const log = path.join(workDir, 'calls.log');
    const bin = fakeGit('spy', `echo "$GIT_OPTIONAL_LOCKS $GIT_TERMINAL_PROMPT $*" >> '${log}'\nexit 1`);
    await read(workDir, { PATH: bin });
    const calls = execFileSync('sort', [log], { encoding: 'utf8' }).trim().split('\n');
    expect(calls).toEqual(['0 0 config --get remote.origin.url', '0 0 rev-parse --verify HEAD', '0 0 symbolic-ref --quiet HEAD']);
  });
});
