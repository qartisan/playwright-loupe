import type { Run } from '../schema/v1.js';

type Env = Readonly<Record<string, string | undefined>>;

/** Returns the value when it is a non-empty string, null otherwise. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** CI providers, checked in order. */
const CI_PROVIDERS: ReadonlyArray<[provider: string, variable: string]> = [
  ['github-actions', 'GITHUB_ACTIONS'],
  ['gitlab', 'GITLAB_CI'],
  ['azure-pipelines', 'TF_BUILD'],
  ['circleci', 'CIRCLECI'],
  ['jenkins', 'JENKINS_URL'],
  ['bitbucket', 'BITBUCKET_BUILD_NUMBER'],
  ['buildkite', 'BUILDKITE'],
  ['travis', 'TRAVIS'],
];

export function detectCi(env: Env): { ci: boolean; ciProvider: string | null } {
  const ciProvider = CI_PROVIDERS.find(([, variable]) => text(env[variable]) !== null)?.[0] ?? null;
  const flag = text(env['CI'])?.toLowerCase();
  return { ci: ciProvider !== null || (flag !== undefined && flag !== 'false' && flag !== '0'), ciProvider };
}

function first(...values: unknown[]): string | null {
  for (const value of values) {
    const found = text(value);
    if (found !== null) return found;
  }
  return null;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
/** `git@github.com:org/repo.git`: a user name without `:` cannot carry a password. */
const SCP_LIKE = /^[^@:/]+@[^@:/]+:[^@]*$/;

/**
 * A remote safe to store: credentials (`https://user:token@host/...`), query
 * (`?access_token=...`) and fragment removed. A URL is parsed like browsers
 * and git do (the last `@` ends the credentials); one without anything to
 * remove is kept as written. Without a scheme, only the scp-like form and
 * strings without `@` (a file path) are kept. Anything else with an `@`
 * cannot be cleaned safely: null.
 */
export function sanitizeRemote(remote: string): string | null {
  if (SCHEME.test(remote)) {
    let url: URL;
    try {
      url = new URL(remote);
    } catch {
      return remote.includes('@') ? null : remote.replace(/[?#].*$/, '');
    }
    if (!/[@?#]/.test(remote)) return remote;
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.href;
  }
  if (!remote.includes('@')) return remote;
  return SCP_LIKE.test(remote) ? remote : null;
}

function githubBranch(env: Env): string | null {
  // GITHUB_HEAD_REF is set on pull requests; GITHUB_REF_NAME is a tag name on tag pushes.
  return first(env['GITHUB_HEAD_REF'], env['GITHUB_REF_TYPE'] === 'branch' ? env['GITHUB_REF_NAME'] : undefined);
}

function githubRemote(env: Env): string | null {
  const server = text(env['GITHUB_SERVER_URL']);
  const repository = text(env['GITHUB_REPOSITORY']);
  return server && repository ? `${server}/${repository}` : null;
}

/** What `readLocalGit()` found, and whether the report is written by `merge-reports`. */
export interface LocalGitSource {
  git: { commit: string | null; branch: string | null; remote: string | null };
  merged: boolean;
}

/** Shortest commit prefix compared with a local hash: git's default abbreviation. */
const MIN_COMMIT_PREFIX = 7;

/** True when `commit` (full, or abbreviated as some CI variables are) names the local `HEAD`. */
function isLocalHead(commit: string, localHead: string): boolean {
  const prefix = commit.toLowerCase();
  return prefix.length >= MIN_COMMIT_PREFIX && /^[0-9a-f]+$/.test(prefix) && localHead.toLowerCase().startsWith(prefix);
}

/**
 * Git info from Playwright's own metadata first (`metadata.gitCommit`, captured
 * when `captureGitInfo.commit` is on, by default in CI; `metadata.ci`), then
 * from common CI environment variables, then from the local repository.
 *
 * Each field is filled independently, with two guards on local values: the
 * local commit is only used when the run is not merged (`merge-reports` may run
 * on another machine or checkout), and the local branch and remote only when
 * the local `HEAD` is the commit of the report.
 */
export function detectGit(metadata: Readonly<Record<string, unknown>>, env: Env, local?: LocalGitSource): Run['git'] {
  const gitCommit = record(metadata['gitCommit']);
  const ciInfo = record(metadata['ci']);
  // A detached checkout reports the branch as "HEAD", which is not a branch.
  const playwrightBranch = [gitCommit['branch'], ciInfo['branch']].find(
    (branch) => text(branch) !== null && text(branch) !== 'HEAD',
  );

  const commit = first(
    gitCommit['hash'],
    ciInfo['commitHash'],
    env['GITHUB_SHA'],
    env['CI_COMMIT_SHA'],
    env['BUILD_SOURCEVERSION'],
    env['CIRCLE_SHA1'],
    env['GIT_COMMIT'],
    env['BITBUCKET_COMMIT'],
    env['BUILDKITE_COMMIT'],
  );
  const branch = first(
    playwrightBranch,
    env['GITHUB_ACTIONS'] ? githubBranch(env) : undefined,
    env['CI_COMMIT_BRANCH'],
    env['CI_MERGE_REQUEST_SOURCE_BRANCH_NAME'],
    env['BUILD_SOURCEBRANCHNAME'],
    env['CIRCLE_BRANCH'],
    env['GIT_BRANCH'],
    env['BITBUCKET_BRANCH'],
    env['BUILDKITE_BRANCH'],
  );
  const remote = first(
    env['GITHUB_ACTIONS'] ? githubRemote(env) : undefined,
    env['CI_PROJECT_URL'],
    env['BUILD_REPOSITORY_URI'],
    env['CIRCLE_REPOSITORY_URL'],
    env['GIT_URL'],
    env['BITBUCKET_GIT_HTTP_ORIGIN'],
    env['BUILDKITE_REPO'],
  );
  if (!local) return { commit, branch, remote: remote === null ? null : sanitizeRemote(remote) };

  const localHead = local.git.commit;
  const finalCommit = commit ?? (local.merged ? null : localHead);
  const atLocalHead = finalCommit !== null && localHead !== null && isLocalHead(finalCommit, localHead);
  const finalRemote = remote ?? (atLocalHead ? local.git.remote : null);
  return {
    commit: finalCommit,
    branch: branch ?? (atLocalHead ? local.git.branch : null),
    remote: finalRemote === null ? null : sanitizeRemote(finalRemote),
  };
}

/** `name` comes from the config (`environment` option, overridden by `LOUPE_ENV`). */
export function detectEnvironment(
  env: Env,
  name: string | null,
  platform: string,
  arch: string,
  nodeVersion: string,
): Run['environment'] {
  return {
    name: text(name),
    ...detectCi(env),
    os: `${platform}-${arch}`,
    nodeVersion,
  };
}
