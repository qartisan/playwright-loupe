import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { gunzip as gunzipCallback } from 'node:zlib';
import { HISTORY_VERSION, type HistoryRunFile } from '../../schema/history-v1.js';
import { createPathRewriter } from '../paths.js';
import { REDACTED, createRedactor, type RedactOptions } from '../redact.js';
import { parseRunFileName, type RunFileName } from './runFile.js';
import { RUNS_FOLDER } from './write.js';

/** Runs of the current stream read at the start of a run: the window. */
export const WINDOW_RUNS = 20;
/** Run file names given in a warning, at most. */
const NAMED_FILES = 3;
/**
 * Largest decompressed run file read: about 64 MB, where a real one is about
 * 1 MB at 5,000 tests. Beyond it the file is corrupt, so a decompression bomb
 * (a poisoned CI cache) never fills the memory of the run.
 */
export const MAX_RUN_FILE_BYTES = 64 * 1024 * 1024;

const gunzip = promisify(gunzipCallback);

const code = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | null)?.code;
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Newest first; names break ties so the order never depends on the file system. */
function newestFirst(a: RunFileName, b: RunFileName): number {
  return b.startedAt - a.startedAt || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0);
}

/**
 * The run files of the history folder, newest first. Only names of run files
 * count: temporary files (a dot first) and anything else are ignored. A
 * missing folder is an empty history.
 */
export async function listRunFiles(dir: string): Promise<RunFileName[]> {
  let names: string[];
  try {
    names = await readdir(path.join(dir, RUNS_FOLDER));
  } catch (error) {
    if (code(error) === 'ENOENT') return [];
    throw error;
  }
  return names
    .map(parseRunFileName)
    .filter((file): file is RunFileName => file !== null)
    .sort(newestFirst);
}

/** From names alone: the newest runs of the stream, and the newest run of every other stream. */
export function selectWindow(files: readonly RunFileName[], stream: string, size: number = WINDOW_RUNS): { own: RunFileName[]; others: RunFileName[] } {
  const sorted = [...files].sort(newestFirst);
  const own = sorted.filter((file) => file.stream === stream).slice(0, size);
  const seen = new Set<string>([stream]);
  const others: RunFileName[] = [];
  for (const file of sorted) {
    if (seen.has(file.stream)) continue;
    seen.add(file.stream);
    others.push(file);
  }
  return { own, others };
}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isOptional = (value: unknown, check: (value: unknown) => boolean): boolean => value === undefined || check(value);
const isNullable = (value: unknown, check: (value: unknown) => boolean): boolean => value === null || check(value);
const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

function isFailure(value: unknown): boolean {
  return (
    isObject(value) &&
    isNumber(value['i']) &&
    isStrings(value['sig']) &&
    isOptional(value['cat'], (cat) => isNullable(cat, isString)) &&
    isOptional(value['x'], isString) &&
    isOptional(value['xc'], isBoolean) &&
    isOptional(value['at'], (at) => isNullable(at, isString))
  );
}

function isTest(value: unknown): boolean {
  return (
    isObject(value) &&
    isString(value['id']) &&
    isOptional(value['r'], isNumber) &&
    isStrings(value['t']) &&
    isString(value['o']) &&
    isNumber(value['d']) &&
    isOptional(value['a'], isString) &&
    isOptional(value['f'], (f) => Array.isArray(f) && f.every(isFailure))
  );
}

function isRunError(value: unknown): boolean {
  return isObject(value) && isString(value['sig']) && isNullable(value['cat'], isString) && isString(value['x']) && isOptional(value['xc'], isBoolean) && isNullable(value['at'], isString);
}

function isProject(value: unknown): boolean {
  return isObject(value) && isString(value['name']) && isNumber(value['retries']);
}

function isGit(value: unknown): boolean {
  return isObject(value) && isNullable(value['commit'], isString) && isNullable(value['branch'], isString);
}

/** What readers rely on; other keys are not checked, so an optional key added later is read as before. */
function isRun(value: unknown): boolean {
  if (!isObject(value)) return false;
  const excluded = value['excluded'];
  return (
    isGit(value['git']) &&
    Array.isArray(value['projects']) &&
    value['projects'].every(isProject) &&
    isString(value['id']) &&
    isString(value['startedAt']) &&
    isNumber(value['durationMs']) &&
    isString(value['status']) &&
    isString(value['origin']) &&
    isObject(value['stream']) &&
    isString(value['scope']) &&
    isStrings(value['scopeReasons']) &&
    (excluded === null || (isObject(excluded) && isString(excluded['reason']) && isOptional(excluded['cut'], isBoolean))) &&
    Array.isArray(value['errors']) &&
    value['errors'].every(isRunError)
  );
}

/**
 * The JSON text of a run file, once decompressed: the file, `newer` when a later Loupe wrote it
 * (another history version, which this one cannot read), `corrupt` otherwise.
 */
export function parseRunFile(text: string): HistoryRunFile | 'newer' | 'corrupt' {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return 'corrupt';
  }
  if (!isObject(value) || !Number.isInteger(value['historyVersion']) || (value['historyVersion'] as number) < 1) return 'corrupt';
  if ((value['historyVersion'] as number) > HISTORY_VERSION) return 'newer';
  const valid =
    Number.isInteger(value['signatureVersion']) &&
    isString(value['loupeVersion']) &&
    isString(value['playwrightVersion']) &&
    isRun(value['run']) &&
    Array.isArray(value['tests']) &&
    value['tests'].every(isTest);
  return valid ? (value as unknown as HistoryRunFile) : 'corrupt';
}

/**
 * A run file as stored, gzipped: decompressed, then parsed. Anything that does
 * not decompress (plain text, a truncated file, beyond `maxBytes`) is corrupt.
 */
export async function decodeRunFile(content: Buffer, maxBytes: number = MAX_RUN_FILE_BYTES): Promise<HistoryRunFile | 'newer' | 'corrupt'> {
  let text: string;
  try {
    text = (await gunzip(content, { maxOutputLength: maxBytes })).toString('utf8');
  } catch {
    return 'corrupt';
  }
  return parseRunFile(text);
}

/**
 * The redaction of the current run, replayed on a text read from disk. `cut`: the text was cut when it was
 * written (`xc`, `excluded.cut`).
 */
export type Replay = (text: string, cut?: boolean) => string;

/**
 * The shortest start of a `redact.env` value masked at the end of a cut text: 1 character, so that no
 * character of a value is ever left. The end of a cut text is arbitrary and nothing is compared on it
 * (signatures are stored apart), so a false positive costs a character or two of that text, shown as
 * `[redacted]`: at 1 character, about one cut text in 30 to 60 per value (one character in a text's
 * alphabet); at 2, about one in a thousand or more. A minimum of 3 would leave up to 2 characters of a value
 * in clear, a third of the shortest one used (MIN_SECRET_LENGTH, 6).
 */
export const MIN_CUT_START = 1;

/**
 * `text`, a cut text already replayed, with its longest end that is the start of one of `values` (of
 * MIN_CUT_START characters or more) replaced by `[redacted]`: a value added to redact.env after the run was
 * written, and running across the cut, is only partly in the text, where the replay cannot match it.
 */
export function maskCutStart(text: string, values: readonly string[]): string {
  let longest = 0;
  for (const value of values) {
    for (let length = Math.min(value.length, text.length); length > longest && length >= MIN_CUT_START; length--) {
      if (text.endsWith(value.slice(0, length))) {
        longest = length;
        break;
      }
    }
  }
  return longest === 0 ? text : `${text.slice(0, text.length - longest)}${REDACTED}`;
}

/**
 * The redaction of the current run, replayed on text read from disk: a value added to `redact.env` after a
 * run was recorded, or another home directory, is masked before the text is used. A text cut when it was
 * written also has a value cut short at its end masked (`maskCutStart`); the home directory needs no such
 * rule, since it was masked on the writing machine before the cut. Text read whole on every run (the notes of
 * loupe.notes.json) is never cut, and needs only the first part.
 */
export function createReplay(redact: RedactOptions, home: string | null): Replay {
  const redactor = createRedactor(redact);
  const paths = createPathRewriter({ roots: [], home });
  const values = [...new Set(redact.values)].filter((value) => value !== '');
  return (text, cut = false) => {
    const replayed = paths.selection(redactor.strings(text));
    return cut ? maskCutStart(replayed, values) : replayed;
  };
}

/** A cut exclusion reason, replayed: its `…` stays at the end, after the start of a value it may end with. */
function replayReason(excluded: NonNullable<HistoryRunFile['run']['excluded']>, replay: Replay): NonNullable<HistoryRunFile['run']['excluded']> {
  if (!excluded.cut) return { ...excluded, reason: replay(excluded.reason) };
  const ellipsis = excluded.reason.endsWith('…') ? '…' : '';
  return { ...excluded, reason: `${replay(excluded.reason.slice(0, excluded.reason.length - ellipsis.length), true)}${ellipsis}` };
}

/** The text of a run file that does not come from Loupe's own codes and ids, replayed. */
export function replayRun(file: HistoryRunFile, replay: Replay): HistoryRunFile {
  return {
    ...file,
    run: {
      ...file.run,
      excluded: file.run.excluded === null ? null : replayReason(file.run.excluded, replay),
      errors: file.run.errors.map((error) => ({ ...error, x: replay(error.x, error.xc === true) })),
    },
    tests: file.tests.map((test) =>
      test.f === undefined ? test : { ...test, f: test.f.map((failure) => (failure.x === undefined ? failure : { ...failure, x: replay(failure.x, failure.xc === true) })) },
    ),
  };
}

export interface HistoryRead {
  /** Stream hash the window was read for. */
  stream: string;
  /** The window: the newest runs of the stream, newest first. */
  runs: HistoryRunFile[];
  /** The newest run of every other stream, newest first. */
  others: HistoryRunFile[];
  /**
   * Files of the window that could not be used (corrupt, written by a newer
   * Loupe, unreadable): the window is that much shorter. A file that vanished
   * since the listing is not counted: another run's retention removed it.
   */
  skipped: number;
  /** Problems for the run's single history warning; empty when none. */
  problems: string[];
}

function named(names: readonly string[]): string {
  const shown = names.slice(0, NAMED_FILES).map((name) => `${RUNS_FOLDER}/${name}`);
  return names.length > NAMED_FILES ? `${shown.join(', ')} and ${names.length - NAMED_FILES} more` : shown.join(', ');
}

/**
 * Reads the window of a stream and the newest run of every other stream.
 * Never throws: an unreadable folder is an empty history with a problem. A
 * file that vanished since the listing (retention by another run) is skipped
 * without a word; a corrupt file (one that does not decompress included) or
 * one from a newer Loupe is skipped, never
 * rewritten or removed, and named in one problem. A file with another
 * `signatureVersion` is kept: its statuses compare, its signatures do not.
 */
export async function readHistory(dir: string, stream: string, replay: Replay, size: number = WINDOW_RUNS): Promise<HistoryRead> {
  const empty: HistoryRead = { stream, runs: [], others: [], skipped: 0, problems: [] };
  let files: RunFileName[];
  try {
    files = await listRunFiles(dir);
  } catch (error) {
    return { ...empty, problems: [`the history folder could not be read (${message(error)})`] };
  }
  const { own, others } = selectWindow(files, stream, size);
  const corrupt: string[] = [];
  const newer: string[] = [];
  const unreadable: string[] = [];
  // Files of the window not used, other than vanished ones: the window is that much shorter.
  let skipped = 0;
  const read = async (file: RunFileName, own: boolean): Promise<HistoryRunFile | null> => {
    let content: Buffer;
    try {
      content = await readFile(path.join(dir, RUNS_FOLDER, file.name));
    } catch (error) {
      if (code(error) !== 'ENOENT') {
        unreadable.push(file.name);
        if (own) skipped++;
      }
      return null;
    }
    const parsed = await decodeRunFile(content);
    if (parsed !== 'corrupt' && parsed !== 'newer') return replayRun(parsed, replay);
    (parsed === 'corrupt' ? corrupt : newer).push(file.name);
    if (own) skipped++;
    return null;
  };
  const present = (runs: Array<HistoryRunFile | null>) => runs.filter((run): run is HistoryRunFile => run !== null);
  const [runs, latest] = await Promise.all([Promise.all(own.map((file) => read(file, true))), Promise.all(others.map((file) => read(file, false)))]);
  const problems: string[] = [];
  if (corrupt.length > 0) problems.push(`skipped ${corrupt.length === 1 ? 'a corrupt run file' : `${corrupt.length} corrupt run files`}: ${named(corrupt.sort())}`);
  if (newer.length > 0) problems.push(`skipped ${newer.length === 1 ? 'a run file' : `${newer.length} run files`} written by a newer Loupe: ${named(newer.sort())}`);
  if (unreadable.length > 0) problems.push(`could not read ${named(unreadable.sort())}`);
  return { stream, runs: present(runs), others: present(latest), skipped, problems };
}

/**
 * The window of the stream the report belongs to. The read started in
 * `onBegin` used the stream known then; when the report ends in another one
 * (a branch known only at the end, with `branch` in `stream.key`), the window
 * of the start stream is dropped and the end stream's is read.
 */
export async function windowOfStream(started: HistoryRead, endStream: string, readStream: (stream: string) => Promise<HistoryRead>): Promise<HistoryRead> {
  return started.stream === endStream ? started : readStream(endStream);
}
