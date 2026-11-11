import type { ResolvedHistory } from '../../config/types.js';
import type { LoupeReport } from '../../schema/v1.js';
import { DEFAULT_ENVIRONMENT, type HistoryRunFile } from '../../schema/history-v1.js';
import { createPathRewriter } from '../paths.js';
import { createRedactor, type RedactOptions } from '../redact.js';
import { detectOrigin, historyRunId, streamOf } from './detect.js';
import { encodeRun } from './runFile.js';
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

/** The run file of a report, or why there is none. */
export function buildRunFile(report: LoupeReport, context: RecordContext): HistoryRunFile | SkipReason {
  const skipped = skipReason(report, context);
  if (skipped) return skipped;
  const origin = detectOrigin({ env: context.env, argv: context.argv, configArgv: context.configArgv });
  const environment = report.run.environment.name ?? DEFAULT_ENVIRONMENT;
  const reason = excludeReason(context.env);
  // The reason is the only text not taken from the report: masked the same way.
  const paths = createPathRewriter({ roots: [], home: context.home });
  const masked = reason === null ? null : paths.selection(createRedactor(context.redact).strings(reason));
  return encodeRun(report, {
    id: historyRunId({ env: context.env, merged: context.merged, tests: report.tests }),
    origin,
    environment,
    stream: streamOf(context.history.stream.key, { environment, origin, branch: report.run.git.branch }),
    merged: context.merged,
    excluded: masked === null ? null : { reason: masked },
  });
}

/** Records the run; returns the file written, or why nothing was. Throws on a file system error: the caller warns. */
export async function recordRun(report: LoupeReport, context: RecordContext): Promise<{ file: string } | { skipped: SkipReason }> {
  const run = buildRunFile(report, context);
  if (typeof run === 'string') return { skipped: run };
  return { file: await writeRunFile(context.history.dir, run) };
}
