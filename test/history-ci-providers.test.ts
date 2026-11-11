import { describe, expect, it } from 'vitest';
import { CI_RUN_ID_VARIABLES, detectOrigin, historyRunId } from '../src/core/history/detect.js';
import { CI_PROVIDERS, detectCi, detectGit } from '../src/core/metadata.js';

/**
 * Each provider's own variables, from its documentation, written here rather
 * than read from the code: the origin, the commit and the run id must agree on
 * every provider Loupe knows.
 */
const PROVIDERS: Record<string, { marker: Record<string, string>; commit: string; runId: string }> = {
  'github-actions': { marker: { GITHUB_ACTIONS: 'true' }, commit: 'GITHUB_SHA', runId: 'GITHUB_RUN_ID' },
  gitlab: { marker: { GITLAB_CI: 'true' }, commit: 'CI_COMMIT_SHA', runId: 'CI_PIPELINE_ID' },
  'azure-pipelines': { marker: { TF_BUILD: 'True' }, commit: 'BUILD_SOURCEVERSION', runId: 'BUILD_BUILDID' },
  circleci: { marker: { CIRCLECI: 'true' }, commit: 'CIRCLE_SHA1', runId: 'CIRCLE_WORKFLOW_ID' },
  jenkins: { marker: { JENKINS_URL: 'https://jenkins.example/' }, commit: 'GIT_COMMIT', runId: 'BUILD_TAG' },
  bitbucket: { marker: { BITBUCKET_BUILD_NUMBER: '17' }, commit: 'BITBUCKET_COMMIT', runId: 'BITBUCKET_BUILD_NUMBER' },
  buildkite: { marker: { BUILDKITE: 'true' }, commit: 'BUILDKITE_COMMIT', runId: 'BUILDKITE_BUILD_ID' },
  travis: { marker: { TRAVIS: 'true' }, commit: 'TRAVIS_COMMIT', runId: 'TRAVIS_BUILD_ID' },
};

const SHA = '0123456789abcdef0123456789abcdef01234567';
const TESTS = [{ id: 'a1', repeatEachIndex: 0, attempts: [{ startedAt: '2026-11-11T10:00:00.000Z' }] }];

describe('CI providers: origin, commit and run id agree', () => {
  it('every provider of the CI detection has a row here and a run id variable', () => {
    const names = CI_PROVIDERS.map(([provider]) => provider);
    expect(Object.keys(PROVIDERS).sort()).toEqual([...names].sort());
    expect(Object.keys(CI_RUN_ID_VARIABLES).sort()).toEqual([...names].sort());
  });

  // No CI=true: the provider's own variables must be enough.
  it.each(Object.entries(PROVIDERS))('%s: origin ci, the commit, and its run id in the history run id', (provider, { marker, commit, runId }) => {
    const ciId = marker[runId] ?? '4242';
    const env = { ...marker, [commit]: SHA, [runId]: ciId };
    expect(detectCi(env)).toEqual({ ci: true, ciProvider: provider });
    expect(detectOrigin({ env, argv: ['node', 'playwright', 'test'] })).toBe('ci');
    expect(detectGit({}, env).commit).toBe(SHA);
    expect(historyRunId({ env, merged: false, tests: TESTS })).toMatch(new RegExp(`^${provider}-${ciId}-[0-9a-f]{8}$`));
  });

  it('travis: the source branch of a pull request, else the branch', () => {
    const env = { TRAVIS: 'true', TRAVIS_BRANCH: 'main' };
    expect(detectGit({}, env).branch).toBe('main');
    expect(detectGit({}, { ...env, TRAVIS_PULL_REQUEST_BRANCH: 'feature' }).branch).toBe('feature');
    // TRAVIS_BRANCH alone is no Travis signal.
    expect(detectGit({}, { TRAVIS_BRANCH: 'main' }).branch).toBeNull();
  });
});
