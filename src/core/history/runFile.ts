import type { LoupeError, LoupeReport, SourceLocation, TestCase } from '../../schema/v1.js';
import {
  ATTEMPT_CODES,
  HISTORY_VERSION,
  OUTCOME_CODES,
  type HistoryError,
  type HistoryFailure,
  type HistoryRun,
  type HistoryRunFile,
  type HistoryTest,
} from '../../schema/history-v1.js';
import { SIGNATURE_VERSION } from '../signature.js';

/** Length of an error extract, in characters. */
export const EXTRACT_CHARS = 300;
/** A cut at a line end is kept only when it keeps at least this much. */
const MIN_LINE_CUT = 120;

/**
 * The first lines of a message, about 300 characters: cut at the last line
 * end before the limit when that keeps enough, otherwise at the limit. The
 * message is the report's, already redacted and path-rewritten: a prefix can
 * only drop characters, never reveal one.
 */
export function extract(message: string): string {
  if (message.length <= EXTRACT_CHARS) return message;
  let cut = message.slice(0, EXTRACT_CHARS);
  const newline = cut.lastIndexOf('\n');
  if (newline >= MIN_LINE_CUT) cut = cut.slice(0, newline);
  // Never end on half of a surrogate pair.
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

function at(location: SourceLocation | null): string | null {
  return location ? `${location.file}:${location.line}:${location.column}` : null;
}

function failure(index: number, errors: readonly LoupeError[]): HistoryFailure {
  const first = errors[0];
  const entry: HistoryFailure = { i: index, sig: errors.map((error) => error.signature) };
  if (first) {
    entry.cat = first.category;
    entry.x = extract(first.message);
    entry.at = at(first.location);
  }
  return entry;
}

function encodeTest(test: TestCase): HistoryTest {
  const outcome = OUTCOME_CODES[test.outcome];
  const row: HistoryTest = { id: test.id, t: [test.project, test.file, ...test.suitePath, test.title], o: outcome, d: test.durationMs };
  if (test.repeatEachIndex !== 0) row.r = test.repeatEachIndex;
  const attempts = test.attempts.map((attempt) => ATTEMPT_CODES[attempt.status]).join('');
  // A single attempt that ended as the outcome says is the common case: implied.
  const implied = (outcome === 'P' && attempts === 'P') || (outcome === 'S' && attempts === 'S');
  if (!implied) row.a = attempts;
  // Failed attempts, as in the report: not as expected, and not skipped (a test.fail() failing is not one).
  const failures = test.attempts
    .filter((attempt) => attempt.status !== test.expectedStatus && attempt.status !== 'skipped')
    .map((attempt) => failure(attempt.index, attempt.errors));
  if (failures.length > 0) row.f = failures;
  return row;
}

export interface RunMeta {
  id: string;
  origin: HistoryRun['origin'];
  environment: string;
  stream: HistoryRun['stream'];
  merged: boolean;
  excluded: HistoryRun['excluded'];
}

/**
 * The run file of a report. Everything comes from the final report, so the
 * text is already redacted and its paths rewritten; only `meta.excluded` is
 * not, and the caller masks it.
 */
export function encodeRun(report: LoupeReport, meta: RunMeta): HistoryRunFile {
  const { run } = report;
  return {
    historyVersion: HISTORY_VERSION,
    signatureVersion: SIGNATURE_VERSION,
    loupeVersion: report.generator.version,
    playwrightVersion: run.playwrightVersion,
    run: {
      id: meta.id,
      startedAt: run.startedAt,
      durationMs: run.durationMs,
      status: run.status,
      origin: meta.origin,
      environment: meta.environment,
      stream: meta.stream,
      scope: run.scope,
      scopeReasons: [...run.scopeReasons],
      merged: meta.merged,
      excluded: meta.excluded,
      ciProvider: run.environment.ciProvider,
      git: { commit: run.git.commit, branch: run.git.branch },
      stats: { ...run.stats },
      projects: report.projects.map((project) => ({ name: project.name, retries: project.retries })),
      errors: run.errors.map((error): HistoryError => ({ sig: error.signature, cat: error.category, x: extract(error.message), at: at(error.location) })),
    },
    tests: report.tests.map(encodeTest),
  };
}

/** `runs/<startedAt>-<run id>.json`, the start time in compact UTC (`20261110T140211.408Z`): names sort by time. */
export function runFileName(startedAt: string, runId: string): string {
  return `${startedAt.replace(/[-:]/g, '')}-${runId}.json`;
}
