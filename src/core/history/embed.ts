import type { LoupeReport } from '../../schema/v1.js';
import {
  EMBEDDED_EXTRACTS,
  EMBEDDED_HISTORY_VERSION,
  NO_RESULT,
  type EmbeddedHistory,
  type EmbeddedRun,
  type HistoryRun,
  type HistoryRunFile,
  type HistoryTest,
} from '../../schema/history-v1.js';
import { SIGNATURE_VERSION } from '../signature.js';
import type { HistoryRead } from './read.js';

export interface EmbedOptions {
  include: EmbeddedHistory['include'];
  /** The stream of the current run. */
  stream: HistoryRun['stream'];
  /** The current run's origin and masked exclusion reason. */
  current: EmbeddedHistory['current'];
  /** The history run id of the current run: a re-run merge finds its own earlier file in the window, which is not its past. */
  currentRunId: string;
}

const key = (id: string, repeatEachIndex: number): string => `${id}\u0000${repeatEachIndex}`;

/** The tests of a run file by test id and repeat index. */
function byTest(file: HistoryRunFile): Map<string, HistoryTest> {
  return new Map(file.tests.map((test) => [key(test.id, test.r ?? 0), test]));
}

function embeddedRun(file: HistoryRunFile): EmbeddedRun {
  const { run } = file;
  return {
    id: run.id,
    reportRunId: run.reportRunId,
    startedAt: run.startedAt,
    durationMs: run.durationMs,
    status: run.status,
    origin: run.origin,
    scope: run.scope,
    scopeReasons: run.scopeReasons,
    excluded: run.excluded?.reason ?? null,
    commit: run.git.commit,
    branch: run.git.branch,
    stats: run.stats,
    projects: run.projects.map((project): [string, number] => [project.name, project.retries]),
    sameSignatures: file.signatureVersion === SIGNATURE_VERSION,
  };
}

/** The signature a cell is compared on: the first error of its first failed attempt. */
function cellFailure(test: HistoryTest | undefined): { sig: string; cat: string | null; x: string | null } | null {
  const failure = test?.f?.[0];
  const sig = failure?.sig[0];
  return failure && sig !== undefined ? { sig, cat: failure.cat ?? null, x: failure.x ?? null } : null;
}

const failing = (code: string | undefined): boolean => code === 'F' || code === 'K';

/**
 * The embedded history of a report, from the runs read at the start of the
 * run (already replayed through the current redaction). Null when there is no
 * past run to show and no run file was skipped: a window emptied by skipped
 * files (a newer Loupe's, corrupt) is embedded with no run, so the report can
 * say why.
 */
export function deriveEmbedded(report: LoupeReport, read: Pick<HistoryRead, 'runs' | 'others' | 'skipped'>, options: EmbedOptions): EmbeddedHistory | null {
  const past = (file: HistoryRunFile) => file.run.id !== options.currentRunId;
  // Oldest first, as columns read left to right.
  const window = read.runs.filter(past).reverse();
  const others = read.others.filter(past);
  if (window.length === 0 && others.length === 0 && read.skipped === 0) return null;

  const keys = report.tests.map((test) => key(test.id, test.repeatEachIndex));
  const rows = window.map(byTest);
  const sameSignatures = window.map((file) => file.signatureVersion === SIGNATURE_VERSION);

  // The dictionary, most recently seen first: the extract cap keeps the newest ones.
  const signatures: EmbeddedHistory['signatures'] = [];
  const index = new Map<string, number>();
  for (let run = window.length - 1; run >= 0; run--) {
    if (!sameSignatures[run]) continue;
    for (const testKey of keys) {
      const test = rows[run]?.get(testKey);
      if (!failing(test?.o)) continue;
      const failure = cellFailure(test);
      if (failure === null || index.has(failure.sig)) continue;
      index.set(failure.sig, signatures.length);
      signatures.push([failure.sig, failure.cat, signatures.length < EMBEDDED_EXTRACTS ? failure.x : null]);
    }
  }

  let cells = '';
  const attempts: EmbeddedHistory['attempts'] = [];
  const failures: EmbeddedHistory['failures'] = [];
  const failureAttempts: string[] = [];
  keys.forEach((testKey, testIndex) => {
    const sigs: number[] = [];
    rows.forEach((row, run) => {
      const test = row.get(testKey);
      cells += test?.o ?? NO_RESULT;
      if (!failing(test?.o)) {
        if (test?.a !== undefined) attempts.push([testIndex, run, test.a]);
        return;
      }
      failureAttempts.push(test?.a ?? '');
      const failure = sameSignatures[run] ? cellFailure(test) : null;
      sigs.push(failure === null ? -1 : (index.get(failure.sig) ?? -1));
    });
    if (sigs.length > 0) failures.push([testIndex, ...sigs]);
  });

  return {
    v: EMBEDDED_HISTORY_VERSION,
    include: options.include,
    signatureVersion: SIGNATURE_VERSION,
    stream: options.stream,
    current: options.current,
    skipped: read.skipped,
    runs: window.map(embeddedRun),
    cells,
    failures,
    failureAttempts: failureAttempts.join(' '),
    attempts,
    signatures,
    others: others.map((file) => {
      const row = byTest(file);
      return { stream: file.run.stream, id: file.run.id, startedAt: file.run.startedAt, cells: keys.map((testKey) => row.get(testKey)?.o ?? NO_RESULT).join('') };
    }),
  };
}
