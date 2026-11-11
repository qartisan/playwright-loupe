import path from 'node:path';
import type { ResolvedHistory } from '../../config/types.js';
import type { LoupeReport } from '../../schema/v1.js';
import { DEFAULT_ENVIRONMENT, type HistoryRun, type HistoryRunFile, type Origin } from '../../schema/history-v1.js';
import { createPathRewriter } from '../paths.js';
import { createRedactor, type RedactOptions } from '../redact.js';
import { detectOrigin, historyRunId, streamOf } from './detect.js';
import { pruneHistory } from './retain.js';
import { encodeRun, streamHash } from './runFile.js';
import { writeRunFile } from './write.js';

type Env = Readonly<Record<string, string | undefined>>;

/** Records the run as excluded from statistics, with this reason. */
export const EXCLUDE_ENV = 'LOUPE_EXCLUDE';
/** Longest exclusion reason kept. */
const MAX_REASON = 200;

/** Why a run is not recorded; null when it is. */
export type SkipReason = 'disabled' | 'list' | 'no-test-ran' | 'blob';

export interface RecordContext {
  history: ResolvedHistory;
  /** Playwright's `_mode`: `list` under `--list`. */
  list: boolean;
  /** Written by `merge-reports`. */
  merged: boolean;
  /** Names of the reporters of the run (`config.reporter`). */
  reporters: readonly string[];
  env: Env;
  argv: readonly string[];
  configArgv?: readonly string[] | undefined;
  /** To mask the exclusion reason as the rest of the report is. */
  redact: RedactOptions;
  home: string | null;
}

/**
 * Runs that are never recorded:
 *
 * - `--list`: nothing ran;
 * - no test has an attempt: an empty shard, a run stopped before any test;
 * - a run that writes a blob (a shard of a sharded run): its history is
 *   written once, by `merge-reports`.
 */
export function skipReason(report: LoupeReport, context: Pick<RecordContext, 'history' | 'list' | 'merged' | 'reporters'>): SkipReason | null {
  if (!context.history.enabled) return 'disabled';
  if (context.list || report.run.scopeReasons.includes('list')) return 'list';
  if (!report.tests.some((test) => test.attempts.length > 0)) return 'no-test-ran';
  if (!context.merged && context.reporters.includes('blob')) return 'blob';
  return null;
}

/** The reason in `LOUPE_EXCLUDE`, trimmed, null when unset or blank. */
export function excludeReason(env: Env): string | null {
  const reason = env[EXCLUDE_ENV]?.trim() ?? '';
  if (reason === '') return null;
  return reason.length > MAX_REASON ? `${reason.slice(0, MAX_REASON - 1)}…` : reason;
}

export interface RunIdentity {
  origin: Origin;
  environment: string;
  stream: HistoryRun['stream'];
  /** `stream` in file names. */
  streamHash: string;
}

/**
 * Origin, environment and stream of a run. The reporter computes it at the
 * start, to read the window, and the run file from the final report: the
 * same function, so both agree unless the branch is only known at the end.
 */
export function runIdentity(input: {
  history: ResolvedHistory;
  env: Env;
  argv: readonly string[];
  configArgv?: readonly string[] | undefined;
  /** The report's `run.environment.name`: trimmed, null when unset. */
  environmentName: string | null;
  branch: string | null;
}): RunIdentity {
  const origin = detectOrigin({ env: input.env, argv: input.argv, configArgv: input.configArgv });
  const environment = input.environmentName ?? DEFAULT_ENVIRONMENT;
  const stream = streamOf(input.history.stream.key, { environment, origin, branch: input.branch });
  return { origin, environment, stream, streamHash: streamHash(stream) };
}

/** The identity of the run of a report. */
export function reportIdentity(report: LoupeReport, context: Pick<RecordContext, 'history' | 'env' | 'argv' | 'configArgv'>): RunIdentity {
  return runIdentity({ ...context, environmentName: report.run.environment.name, branch: report.run.git.branch });
}

/** The run file of a report, or why there is none. */
export function buildRunFile(report: LoupeReport, context: RecordContext): HistoryRunFile | SkipReason {
  const skipped = skipReason(report, context);
  if (skipped) return skipped;
  const { origin, environment, stream } = reportIdentity(report, context);
  const reason = excludeReason(context.env);
  // The reason is the only text not taken from the report: masked the same way.
  const paths = createPathRewriter({ roots: [], home: context.home });
  const masked = reason === null ? null : paths.selection(createRedactor(context.redact).strings(reason));
  return encodeRun(report, {
    id: historyRunId({ env: context.env, merged: context.merged, tests: report.tests }),
    origin,
    environment,
    stream,
    merged: context.merged,
    excluded: masked === null ? null : { reason: masked },
  });
}

export type RecordResult =
  | { skipped: SkipReason }
  | {
      file: string;
      /** Run files removed by the retention. */
      removed: string[];
      /** Why the retention stopped, null when it ran: the run is recorded all the same. */
      pruneError: unknown;
    };

/**
 * Records the run, then applies the retention from a new listing of the
 * folder (another run may have written since the start). Throws when the run
 * file cannot be written: the caller warns.
 */
export async function recordRun(report: LoupeReport, context: RecordContext, now: () => number = Date.now): Promise<RecordResult> {
  const run = buildRunFile(report, context);
  if (typeof run === 'string') return { skipped: run };
  const file = await writeRunFile(context.history.dir, run);
  const { retention } = context.history;
  try {
    const removed = await pruneHistory(context.history.dir, {
      stream: streamHash(run.run.stream),
      maxRuns: retention.maxRuns,
      maxAgeDays: retention.maxAgeDays,
      now: now(),
      keep: path.basename(file),
    });
    return { file, removed, pruneError: null };
  } catch (error) {
    return { file, removed: [], pruneError: error };
  }
}
