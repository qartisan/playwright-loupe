import { createHash, randomUUID } from 'node:crypto';
import { DEFAULT_ENVIRONMENT, type Origin, type StreamKeyPart } from '../../schema/history-v1.js';
import { detectCi } from '../metadata.js';

type Env = Readonly<Record<string, string | undefined>>;

/** `--ui`, `--ui-port` and `--ui-host`, alone or with `=value`: UI mode. */
const UI_OPTION = /^--ui(?:-port|-host)?(?:=|$)/;

export interface OriginInput {
  env: Env;
  /** The process's command line (`process.argv`). */
  argv: readonly string[];
  /** `config.argv` (Playwright 1.61+, empty under watch mode and `merge-reports`); undefined before. */
  configArgv?: readonly string[] | undefined;
}

/**
 * Where a run comes from, checked against Playwright 1.52, 1.57, 1.64.1 and
 * 1.65 (brief 23):
 *
 * - `ci`: a CI is detected, as for `run.environment.ci`;
 * - `ide`: the VS Code extension (it starts `playwright test-server`), UI
 *   mode (`--ui`, `--ui-port`, `--ui-host`) or watch mode (`PWTEST_WATCH`).
 *   Config reporters run in all three. The `VSCODE_*` variables are no signal:
 *   any terminal inside VS Code has them;
 * - `local` otherwise.
 *
 * Under `merge-reports`, the merge process decides: `ci` in a CI job.
 */
export function detectOrigin(input: OriginInput): Origin {
  if (detectCi(input.env).ci) return 'ci';
  if (input.argv[2] === 'test-server') return 'ide';
  const args = [...input.argv.slice(2), ...(input.configArgv ?? [])];
  if (args.some((arg) => UI_OPTION.test(arg))) return 'ide';
  if ((input.env['PWTEST_WATCH'] ?? '').trim() !== '') return 'ide';
  return 'local';
}

/** The stream of a run: the configured key parts, in their order. */
export function streamOf(
  key: readonly StreamKeyPart[],
  values: { environment: string | null; origin: Origin; branch: string | null },
): Partial<Record<StreamKeyPart, string | null>> {
  const all = { environment: values.environment ?? DEFAULT_ENVIRONMENT, origin: values.origin, branch: values.branch };
  return Object.fromEntries(key.map((part) => [part, all[part]]));
}

/** The variable holding the CI's own run id, per provider of `detectCi`. */
export const CI_RUN_ID_VARIABLES: Readonly<Record<string, string>> = {
  'github-actions': 'GITHUB_RUN_ID',
  gitlab: 'CI_PIPELINE_ID',
  'azure-pipelines': 'BUILD_BUILDID',
  circleci: 'CIRCLE_WORKFLOW_ID',
  jenkins: 'BUILD_TAG',
  bitbucket: 'BITBUCKET_BUILD_NUMBER',
  buildkite: 'BUILDKITE_BUILD_ID',
  travis: 'TRAVIS_BUILD_ID',
};

/** Longest CI run id kept in a run id (and so in a file name). */
const MAX_CI_ID = 64;

/** A value safe in a file name on every platform: letters, digits, `.`, `_`, `-`. */
function fileSafe(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._-]+/, '').slice(0, MAX_CI_ID);
}

export interface HashedTest {
  id: string;
  repeatEachIndex: number;
  attempts: ReadonlyArray<{ startedAt: string }>;
}

/**
 * 8 hex characters over the sorted test ids and their attempts' start times.
 * Merging the same blobs again gives the same hash; running the tests again
 * gives another one.
 */
export function contentHash(tests: readonly HashedTest[]): string {
  const lines = tests.map((test) => `${test.id}:${test.repeatEachIndex}:${test.attempts.map((attempt) => attempt.startedAt).join(',')}`).sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 8);
}

/**
 * The run id of the run file, also the key of later notes and exclusions:
 *
 * - in a CI with a run id: `<provider>-<CI run id>-<content hash>`. The hash
 *   tells apart the jobs of a matrix sharing one run id, and keeps one file
 *   when only the merge job is re-run (its attempt number changes, not the
 *   results);
 * - a merge outside CI: `merge-<content hash>`;
 * - otherwise a random UUID.
 */
export function historyRunId(input: { env: Env; merged: boolean; tests: readonly HashedTest[]; random?: () => string }): string {
  const { ciProvider } = detectCi(input.env);
  const variable = ciProvider ? CI_RUN_ID_VARIABLES[ciProvider] : undefined;
  const ciId = variable ? fileSafe((input.env[variable] ?? '').trim()) : '';
  if (ciProvider && ciId !== '') return `${ciProvider}-${ciId}-${contentHash(input.tests)}`;
  if (input.merged) return `merge-${contentHash(input.tests)}`;
  return (input.random ?? randomUUID)();
}
