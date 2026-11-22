import { gzipSync } from 'node:zlib';
import type { LoupeReport } from '../../schema/v1.js';
import {
  EMBEDDED_EXTRACTS,
  EMBEDDED_HISTORY_VERSION,
  NO_RESULT,
  type EmbeddedHistory,
  type EmbeddedOtherRun,
  type EmbeddedRun,
  type HistoryRun,
  type HistoryRunFile,
  type HistoryTest,
  type RunNotes,
  type Trimmed,
} from '../../schema/history-v1.js';
import type { NotesFileStatus } from '../../schema/notes-v1.js';
import { serializeForScript } from '../inject.js';
import { SIGNATURE_VERSION } from '../signature.js';
import type { HistoryRead } from './read.js';

export interface EmbedOptions {
  include: EmbeddedHistory['include'];
  /** The stream of the current run. */
  stream: HistoryRun['stream'];
  /** The current run's origin, masked launch exclusion reason and run id; its notes come from `notes`. */
  current: Omit<EmbeddedHistory['current'], keyof RunNotes>;
  /** The history run id of the current run: a re-run merge finds its own earlier file in the window, which is not its past. */
  currentRunId: string;
  /** What loupe.notes.json says, by run id, masked and cut (`notesByRun`). Run files are never rewritten from it. */
  notes: ReadonlyMap<string, RunNotes>;
  notesFile: NotesFileStatus;
  /** Where the notes file is, as the report names it (`notesPath`); null with `history.notes: false`. */
  notesPath: string | null;
}

const key = (id: string, repeatEachIndex: number): string => `${id}\u0000${repeatEachIndex}`;

/** The tests of a run file by test id and repeat index. */
function byTest(file: HistoryRunFile): Map<string, HistoryTest> {
  return new Map(file.tests.map((test) => [key(test.id, test.r ?? 0), test]));
}

/** The notes of a run, each key only when the file has it: nothing is added for a run without notes. */
function notesOf(notes: ReadonlyMap<string, RunNotes>, id: string | null): RunNotes {
  const found = id === null ? undefined : notes.get(id);
  return {
    ...(found?.notesExcluded !== undefined ? { notesExcluded: found.notesExcluded } : {}),
    ...(found?.note !== undefined ? { note: found.note } : {}),
  };
}

function embeddedRun(file: HistoryRunFile, notes: ReadonlyMap<string, RunNotes>): EmbeddedRun {
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
    ...notesOf(notes, run.id),
  };
}

/** The signature a cell is compared on: the first error of its first failed attempt. */
function cellFailure(test: HistoryTest | undefined): { sig: string; cat: string | null; x: string | null; xc: boolean } | null {
  const failure = test?.f?.[0];
  const sig = failure?.sig[0];
  return failure && sig !== undefined ? { sig, cat: failure.cat ?? null, x: failure.x ?? null, xc: failure.xc === true } : null;
}

const failing = (code: string | undefined): boolean => code === 'F' || code === 'K';

/**
 * What the byte budget leaves out of the block, as cuts of the whole one: the oldest `runs` of the window; the
 * signatures of the runs before window index `signaturesFrom`; the extracts beyond the first `extracts` entries of
 * the dictionary; the last (oldest) `streams` other streams. The whole block has no cut.
 */
interface Cuts {
  runs: number;
  signaturesFrom: number;
  extracts: number;
  streams: number;
}

const WHOLE: Cuts = { runs: 0, signaturesFrom: 0, extracts: EMBEDDED_EXTRACTS, streams: 0 };

/**
 * The embedded history of a report, from the runs read at the start of the
 * run (already replayed through the current redaction), whole: no byte
 * budget (`deriveWithinBudget` applies it). Null when there is no past run to
 * show and no run file was skipped: a window emptied by skipped files (a newer
 * Loupe's, corrupt) is embedded with no run, so the report can say why.
 */
export function deriveEmbedded(report: LoupeReport, read: Pick<HistoryRead, 'runs' | 'others' | 'skipped'>, options: EmbedOptions): EmbeddedHistory | null {
  const prepared = prepare(report, read, options);
  return prepared === null ? null : assemble(prepared, WHOLE);
}

type Prepared = NonNullable<ReturnType<typeof prepare>>;

/** What every cut of the block is assembled from. */
function prepare(report: LoupeReport, read: Pick<HistoryRead, 'runs' | 'others' | 'skipped'>, options: EmbedOptions) {
  const past = (file: HistoryRunFile) => file.run.id !== options.currentRunId;
  // Oldest first, as columns read left to right.
  const window = read.runs.filter(past).reverse();
  const others = read.others.filter(past);
  if (window.length === 0 && others.length === 0 && read.skipped === 0) return null;
  const keys = report.tests.map((test) => key(test.id, test.repeatEachIndex));
  // Each run's row of every report test, looked up once for all the cuts the budget may try.
  const grid = window.map((file) => {
    const row = byTest(file);
    return keys.map((testKey) => row.get(testKey));
  });
  return {
    report,
    read,
    options,
    window,
    others,
    tests: keys.length,
    grid,
    failures: grid.map((row) => row.map((test) => (failing(test?.o) ? cellFailure(test) : null))),
    sameSignatures: window.map((file) => file.signatureVersion === SIGNATURE_VERSION),
    runs: window.map((file) => embeddedRun(file, options.notes)),
    otherRuns: others.map((file): EmbeddedOtherRun => {
      const row = byTest(file);
      return { stream: file.run.stream, id: file.run.id, startedAt: file.run.startedAt, cells: keys.map((testKey) => row.get(testKey)?.o ?? NO_RESULT).join('') };
    }),
  };
}

function assemble(prepared: Prepared, cuts: Cuts): EmbeddedHistory {
  const { report, read, options, window, tests, grid, sameSignatures } = prepared;
  const first = cuts.runs;
  const signaturesFrom = Math.max(first, cuts.signaturesFrom);
  const compared = (run: number) => run >= signaturesFrom && sameSignatures[run] === true;

  // The dictionary, most recently seen first: the extract cap keeps the newest ones. One entry per distinct
  // signature, without the signature itself: the index tells identical errors apart within the block, and the
  // renderer never reads the hash (about half the block at 5,000 tests, brief 26). A feature that needs "same
  // error as this run" gets an index or a flag computed here, not the hash. Built from the runs whose signatures
  // are kept only: nothing the budget leaves out comes back through the dictionary.
  const signatures: EmbeddedHistory['signatures'] = [];
  const index = new Map<string, number>();
  let extractsLeftOut = false;
  for (let run = window.length - 1; run >= first; run--) {
    if (!compared(run)) continue;
    for (const failure of prepared.failures[run] ?? []) {
      if (failure === null || index.has(failure.sig)) continue;
      index.set(failure.sig, signatures.length);
      const kept = signatures.length < cuts.extracts;
      if (!kept && signatures.length < EMBEDDED_EXTRACTS && failure.x !== null) extractsLeftOut = true;
      const extract = kept ? failure.x : null;
      // A cut extract says so, for the report to mark its end; only with its text.
      signatures.push(extract !== null && failure.xc ? [failure.cat, extract, true] : [failure.cat, extract]);
    }
  }

  const attempts: EmbeddedHistory['attempts'] = [];
  const failures: EmbeddedHistory['failures'] = [];
  const failureAttempts: string[] = [];
  const codes: string[] = [];
  for (let testIndex = 0; testIndex < tests; testIndex++) {
    const sigs: number[] = [];
    for (let run = first; run < window.length; run++) {
      const test = grid[run]?.[testIndex];
      codes.push(test?.o ?? NO_RESULT);
      if (!failing(test?.o)) {
        if (test?.a !== undefined) attempts.push([testIndex, run - first, test.a]);
        continue;
      }
      failureAttempts.push(test?.a ?? '');
      const failure = compared(run) ? prepared.failures[run]?.[testIndex] : null;
      sigs.push(failure == null ? -1 : (index.get(failure.sig) ?? -1));
    }
    if (sigs.length > 0) failures.push([testIndex, ...sigs]);
  }
  const cells = codes.join('');

  const trimmed: Trimmed = {
    ...(extractsLeftOut ? { extracts: signatures.filter(([, extract]) => extract !== null).length } : {}),
    // The start of the first run that keeps its signatures; every run of the window when none does.
    ...(signaturesFrom > first ? { signaturesBefore: window[signaturesFrom]?.run.startedAt ?? report.run.startedAt } : {}),
    ...(cuts.streams > 0 ? { streams: cuts.streams } : {}),
    ...(first > 0 ? { runs: first } : {}),
  };

  return {
    v: EMBEDDED_HISTORY_VERSION,
    include: options.include,
    signatureVersion: SIGNATURE_VERSION,
    stream: options.stream,
    // Only a deterministic id (a merge job or a CI job run again) can already be in the file.
    current: { ...options.current, ...notesOf(options.notes, options.current.id) },
    notesFile: options.notesFile,
    notesPath: options.notesPath,
    skipped: read.skipped,
    runs: prepared.runs.slice(first),
    cells,
    failures,
    failureAttempts: failureAttempts.join(' '),
    attempts,
    signatures,
    others: prepared.otherRuns.slice(0, prepared.otherRuns.length - cuts.streams),
    ...(Object.keys(trimmed).length > 0 ? { trimmed } : {}),
  };
}

/** The byte budget of the block: gzip at the default level, as the report is served. Not configurable. */
export const EMBEDDED_BUDGET_FLOOR = 40_000;
export const EMBEDDED_BUDGET_PER_TEST = 8;

export function embeddedBudget(testCount: number): number {
  return Math.max(EMBEDDED_BUDGET_FLOOR, EMBEDDED_BUDGET_PER_TEST * testCount);
}

/** Gzip bytes of the block as `index.html` embeds it. */
export function embeddedSize(value: EmbeddedHistory): number {
  return gzipSync(serializeForScript(value)).byteLength;
}

/**
 * The embedded history within its byte budget (`embeddedBudget`). Under it, the whole block, after one
 * compression. Over it, parts are left out in this order, each by the smallest cut that fits: the extracts, oldest
 * first; the signatures of past runs, oldest runs first; the other streams, oldest first; the oldest runs, down to
 * the newest one. The search estimates sizes at gzip level 1, scaled to the default level by the whole block's
 * ratio between the two (four to five times faster), and checks the cut it finds at the default level, cutting
 * further when the estimate was short. The block's `trimmed` record says what was left out. Still over the budget
 * with only the newest run: null, and a problem for the history warning. No realistic window reaches it: one run
 * without errors or other streams is about one byte per test, under the eight of the budget.
 */
export function deriveWithinBudget(report: LoupeReport, read: Pick<HistoryRead, 'runs' | 'others' | 'skipped'>, options: EmbedOptions): { value: EmbeddedHistory | null; problems: string[] } {
  const prepared = prepare(report, read, options);
  if (prepared === null) return { value: null, problems: [] };
  const budget = embeddedBudget(report.tests.length);
  const whole = assemble(prepared, WHOLE);
  const wholeText = serializeForScript(whole);
  const wholeSize = gzipSync(wholeText).byteLength;
  if (wholeSize <= budget) return { value: whole, problems: [] };

  const ratio = wholeSize / gzipSync(wholeText, { level: 1 }).byteLength;
  const estimate = (candidate: Cuts) => gzipSync(serializeForScript(assemble(prepared, candidate)), { level: 1 }).byteLength * ratio <= budget;
  const length = prepared.window.length;
  let cuts = WHOLE;
  const steps: Array<{ high: number; make: (value: number) => Cuts }> = [
    // Extracts left out, from the oldest seen: `value` fewer kept.
    { high: EMBEDDED_EXTRACTS, make: (value) => ({ ...cuts, extracts: EMBEDDED_EXTRACTS - value }) },
    // Past runs without their signatures, oldest first. Runs that started at the same time stay together, so the
    // date of `trimmed.signaturesBefore` tells exactly which runs have none.
    { high: length, make: (value) => ({ ...cuts, signaturesFrom: sameStart(prepared.window, value) }) },
    { high: prepared.others.length, make: (value) => ({ ...cuts, streams: value }) },
    // The oldest runs, down to the newest one.
    { high: Math.max(0, length - 1), make: (value) => ({ ...cuts, runs: value }) },
  ];
  for (const step of steps) {
    const fits = (value: number) => embeddedSize(assemble(prepared, step.make(value))) <= budget;
    // Not even the whole step: on to the next one, this part all left out.
    if (step.high < 1 || !fits(step.high)) {
      cuts = step.make(step.high);
      continue;
    }
    // The smallest cut the estimate lets through, then corrected at the default level: the smallest that fits
    // above it when the estimate was short, and below it while a smaller cut still fits when it was cautious.
    let value = smallest(1, step.high, (candidate) => estimate(step.make(candidate)));
    if (!fits(value)) value = smallest(value + 1, step.high, fits);
    else while (value > 1 && fits(value - 1)) value--;
    return { value: assemble(prepared, step.make(value)), problems: [] };
  }
  const left = embeddedSize(assemble(prepared, cuts));
  return { value: null, problems: [`the history was too large to embed (${kB(left)} gzip with only the newest run, over its budget of ${kB(budget)})`] };
}

/** The smallest value of [low, high] that passes `test`, `high` when none below it does (binary search: gzip is close to monotonic in each cut). */
function smallest(low: number, high: number, test: (value: number) => boolean): number {
  let from = low;
  let to = high;
  while (from < to) {
    const middle = Math.floor((from + to) / 2);
    if (test(middle)) to = middle;
    else from = middle + 1;
  }
  return from;
}

/** `index`, moved past the runs that started at the same time as the run before it. */
function sameStart(window: readonly HistoryRunFile[], index: number): number {
  let value = index;
  while (value > 0 && value < window.length && window[value]?.run.startedAt === window[value - 1]?.run.startedAt) value++;
  return value;
}

const kB = (bytes: number) => `${(bytes / 1000).toFixed(1)} kB`;
