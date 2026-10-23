import { execFile } from 'node:child_process';
import { sanitizeRemote } from './metadata.js';

type Env = Readonly<Record<string, string | undefined>>;

/** What Loupe reads from the local repository: never an author, an e-mail or a commit message. */
export interface LocalGit {
  /** Full hash of `HEAD`. */
  commit: string | null;
  /** Branch `HEAD` points to; null on a detached checkout. */
  branch: string | null;
  /** `remote.origin.url`, sanitized; null when absent or when it cannot be sanitized. */
  remote: string | null;
}

export interface ReadLocalGitOptions {
  /** Directory git starts its repository search from; passed as `cwd`, never as an argument. */
  cwd: string;
  env: Env;
  /** Per command. */
  timeoutMs: number;
}

export const LOCAL_GIT_TIMEOUT_MS = 2000;

/** SHA-1 or SHA-256 object name. */
const HASH = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const BRANCH_REF = 'refs/heads/';
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * Runs one read-only git command; its trimmed single-line output, or null on
 * any failure: git missing, not a repository, dubious ownership (exit 128),
 * timeout, or output on several lines.
 */
function git(args: readonly string[], options: ReadLocalGitOptions): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (value: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    let child: ReturnType<typeof execFile>;
    try {
      child = execFile(
        'git',
        args,
        {
          cwd: options.cwd,
          // No lock (`git status` would take one to refresh the index), never a credential prompt.
          env: { ...options.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
          encoding: 'utf8',
          maxBuffer: 64 * 1024,
          windowsHide: true,
        },
        (error, stdout) => {
          const output = String(stdout).trim();
          settle(error || output === '' || CONTROL.test(output) ? null : output);
        },
      );
    } catch {
      settle(null);
      return;
    }
    // Our own timer rather than execFile's `timeout`: the callback waits for stdout
    // to close, which a grandchild process holding it open could delay.
    timer = setTimeout(() => {
      child.kill();
      settle(null);
    }, options.timeoutMs);
    timer.unref();
    child.on('error', () => settle(null));
  });
}

/**
 * Commit, branch and remote of the repository containing `cwd`, from three
 * read-only commands run in parallel. Never throws: a value that cannot be read
 * is null. In a submodule, this is the submodule's own repository.
 */
export async function readLocalGit(options: ReadLocalGitOptions): Promise<LocalGit> {
  const [commit, ref, remote] = await Promise.all([
    git(['rev-parse', '--verify', 'HEAD'], options),
    // Exits 1 on a detached HEAD; the full ref avoids `--short`'s disambiguation (`heads/main`).
    git(['symbolic-ref', '--quiet', 'HEAD'], options),
    git(['config', '--get', 'remote.origin.url'], options),
  ]);
  return {
    commit: commit !== null && HASH.test(commit) ? commit : null,
    branch: ref !== null && ref.startsWith(BRANCH_REF) && ref.length > BRANCH_REF.length ? ref.slice(BRANCH_REF.length) : null,
    remote: remote === null ? null : sanitizeRemote(remote),
  };
}
