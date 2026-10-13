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

/** Removes credentials from a URL-like remote (`https://user:token@host/...`). */
export function stripCredentials(remote: string): string {
  return remote.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, '$1');
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

/**
 * Git info from Playwright's own metadata first (`metadata.gitCommit`, captured
 * when `captureGitInfo.commit` is on, by default in CI; `metadata.ci`), then
 * from common CI environment variables. Never shells out to git.
 */
export function detectGit(metadata: Readonly<Record<string, unknown>>, env: Env): Run['git'] {
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
  return { commit, branch, remote: remote === null ? null : stripCredentials(remote) };
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
