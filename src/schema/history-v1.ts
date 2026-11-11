/**
 * Loupe run history — run file, history version 1. This file is the source of
 * truth for the second public contract of Loupe: the files written under
 * `<history dir>/runs/`. It is independent from the report's `schemaVersion`.
 *
 * Adding an optional key that older readers can ignore keeps
 * `historyVersion`; any other change of shape or meaning needs a new version,
 * and readers keep a reader for every older one.
 *
 * Written minified, one file per run: `runs/<startedAt>-<stream hash>-<run id>.json`.
 * The stream hash names the stream (`stream`) in 8 hex characters, so readers
 * pick a stream's runs from file names alone.
 * Kept free of Node imports so the renderer can import it too.
 */

export const HISTORY_VERSION = 1;

/** Where a run comes from. `ide`: the VS Code extension, UI mode or watch mode. */
export const ORIGINS = ['local', 'ci', 'ide'] as const;
export type Origin = (typeof ORIGINS)[number];

/** What a stream key can be made of. */
export const STREAM_KEY_PARTS = ['environment', 'origin', 'branch'] as const;
export type StreamKeyPart = (typeof STREAM_KEY_PARTS)[number];

/** Environment written when none is configured (`environment`, `LOUPE_ENV`). */
export const DEFAULT_ENVIRONMENT = 'default';

/** Outcome codes (`HistoryTest.o`): passed, failed, flaky, skipped. */
export const OUTCOME_CODES = { passed: 'P', failed: 'F', flaky: 'K', skipped: 'S' } as const;
/** Attempt status codes (`HistoryTest.a`): passed, failed, timed out, skipped, interrupted. */
export const ATTEMPT_CODES = { passed: 'P', failed: 'F', timedOut: 'T', skipped: 'S', interrupted: 'I' } as const;

export type OutcomeCode = (typeof OUTCOME_CODES)[keyof typeof OUTCOME_CODES];

export interface HistoryRunFile {
  historyVersion: 1;
  /** Version of the error signature algorithm; entries of different versions are never compared. */
  signatureVersion: number;
  loupeVersion: string;
  playwrightVersion: string;
  run: HistoryRun;
  tests: HistoryTest[];
}

export interface HistoryRun {
  /** `<ci provider>-<ci run id>-<content hash>`, `merge-<content hash>`, or a random UUID. The key of later notes and exclusions. */
  id: string;
  /** The `run.id` of the report written by the same run (a random UUID): the link to that report. */
  reportRunId: string;
  /** ISO 8601; the earliest shard's start for a merged run. */
  startedAt: string;
  durationMs: number;
  /** Same values as the report's `run.status`. */
  status: string;
  origin: Origin;
  /** `environment` / `LOUPE_ENV`, `default` when unset. */
  environment: string;
  /** The parts of the configured stream key, in the configured order. A branch that is not known is null. */
  stream: Partial<Record<StreamKeyPart, string | null>>;
  scope: 'full' | 'partial';
  scopeReasons: string[];
  /** Written by `merge-reports`. */
  merged: boolean;
  /** Set at launch with `LOUPE_EXCLUDE`. */
  excluded: { reason: string } | null;
  ciProvider: string | null;
  git: { commit: string | null; branch: string | null };
  stats: { total: number; passed: number; failed: number; flaky: number; skipped: number };
  projects: Array<{ name: string; retries: number }>;
  /** Errors outside tests. */
  errors: HistoryError[];
}

export interface HistoryError {
  sig: string;
  cat: string | null;
  /** Extract of the message: its first lines, about 300 characters. */
  x: string;
  /** `file:line:column`, null when unknown. */
  at: string | null;
}

export interface HistoryTest {
  /** The report's test id. */
  id: string;
  /** `repeatEachIndex`, only when not 0. */
  r?: number;
  /** Label: project, file, describe titles, test title. */
  t: string[];
  /** Outcome code. */
  o: OutcomeCode;
  /** Duration of all attempts, in ms. */
  d: number;
  /** One status code per attempt; omitted for a single attempt that passed (or was skipped, for a skipped test). */
  a?: string;
  /** Failed attempts (those that did not end as expected), including the failed attempts of a flaky test. */
  f?: HistoryFailure[];
}

export interface HistoryFailure {
  /** Attempt index. */
  i: number;
  /** Signatures of the attempt's errors; empty when it failed without an error (an unexpected pass of `test.fail()`). */
  sig: string[];
  /** Category, extract and location of the attempt's first error, when it has one. */
  cat?: string | null;
  x?: string;
  at?: string | null;
}
