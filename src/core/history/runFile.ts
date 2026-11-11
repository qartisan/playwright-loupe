import { createHash } from 'node:crypto';
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
      reportRunId: run.id,
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

/** Length of the stream hash in a run file name. */
export const STREAM_HASH_LENGTH = 8;

/**
 * 8 hex characters naming a stream in file names: the window and the
 * retention find a stream's runs from names alone. Computed over the parts of
 * the key, sorted by part, so the order of `stream.key` does not matter; any
 * other change of the key (a part added or removed) starts new streams.
 */
export function streamHash(stream: HistoryRun['stream']): string {
  const parts = Object.entries(stream).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, STREAM_HASH_LENGTH);
}

/** The start time of a run file name: compact UTC (`20261110T140211.408Z`), so names sort by time. */
export function compactTime(startedAt: string): string {
  return startedAt.replace(/[-:]/g, '');
}

/** Run files are gzipped JSON. */
export const RUN_FILE_EXTENSION = '.json.gz';

/** `runs/<startedAt>-<stream hash>-<run id>.json.gz`. */
export function runFileName(startedAt: string, stream: string, runId: string): string {
  return `${compactTime(startedAt)}-${stream}-${runId}${RUN_FILE_EXTENSION}`;
}

/**
 * A run file name; anything else in `runs/` (temporary files, foreign files,
 * plain `.json` files) does not match.
 */
const RUN_FILE_NAME = /^(\d{8}T\d{6}(?:\.\d{3})?Z)-([0-9a-f]{8})-([A-Za-z0-9][A-Za-z0-9._-]*)\.json\.gz$/;

export interface RunFileName {
  name: string;
  /** Start time, in ms since the epoch. */
  startedAt: number;
  stream: string;
  runId: string;
}

/** The parts of a run file name, or null when the name is not one. */
export function parseRunFileName(name: string): RunFileName | null {
  const match = RUN_FILE_NAME.exec(name);
  if (!match) return null;
  const [, time, stream, runId] = match as unknown as [string, string, string, string];
  const iso = `${time.slice(0, 4)}-${time.slice(4, 6)}-${time.slice(6, 8)}T${time.slice(9, 11)}:${time.slice(11, 13)}:${time.slice(13)}`;
  const startedAt = Date.parse(iso);
  return Number.isNaN(startedAt) ? null : { name, startedAt, stream, runId };
}
