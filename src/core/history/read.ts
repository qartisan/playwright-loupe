import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { gunzip as gunzipCallback } from 'node:zlib';
import { HISTORY_VERSION, type HistoryRunFile } from '../../schema/history-v1.js';
import { createPathRewriter } from '../paths.js';
import { createRedactor, type RedactOptions } from '../redact.js';
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

function isFailure(value: unknown): boolean {
  return (
    isObject(value) &&
    isNumber(value['i']) &&
    isStrings(value['sig']) &&
    isOptional(value['cat'], (cat) => isNullable(cat, isString)) &&
    isOptional(value['x'], isString) &&
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
  return isObject(value) && isString(value['sig']) && isNullable(value['cat'], isString) && isString(value['x']) && isNullable(value['at'], isString);
}

/** What readers rely on; other keys are not checked, so an optional key added later is read as before. */
function isRun(value: unknown): boolean {
  if (!isObject(value)) return false;
  const excluded = value['excluded'];
  return (
    isString(value['id']) &&
    isString(value['startedAt']) &&
    isNumber(value['durationMs']) &&
    isString(value['status']) &&
    isString(value['origin']) &&
    isObject(value['stream']) &&
    isString(value['scope']) &&
    isStrings(value['scopeReasons']) &&
    (excluded === null || (isObject(excluded) && isString(excluded['reason']))) &&
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
 * The redaction of the current run, replayed on text read from disk: a value
 * added to `redact.env` after a run was recorded, or another home directory,
 * is masked before the text is used.
 */
export function createReplay(redact: RedactOptions, home: string | null): (text: string) => string {
  const redactor = createRedactor(redact);
  const paths = createPathRewriter({ roots: [], home });
  return (text) => paths.selection(redactor.strings(text));
}

/** The text of a run file that does not come from Loupe's own codes and ids, replayed. */
export function replayRun(file: HistoryRunFile, replay: (text: string) => string): HistoryRunFile {
  return {
    ...file,
    run: {
      ...file.run,
      excluded: file.run.excluded === null ? null : { reason: replay(file.run.excluded.reason) },
      errors: file.run.errors.map((error) => ({ ...error, x: replay(error.x) })),
    },
    tests: file.tests.map((test) =>
      test.f === undefined ? test : { ...test, f: test.f.map((failure) => (failure.x === undefined ? failure : { ...failure, x: replay(failure.x) })) },
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
export async function readHistory(dir: string, stream: string, replay: (text: string) => string, size: number = WINDOW_RUNS): Promise<HistoryRead> {
  const empty: HistoryRead = { stream, runs: [], others: [], problems: [] };
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
  const read = async (file: RunFileName): Promise<HistoryRunFile | null> => {
    let content: Buffer;
    try {
      content = await readFile(path.join(dir, RUNS_FOLDER, file.name));
    } catch (error) {
      if (code(error) !== 'ENOENT') unreadable.push(file.name);
      return null;
    }
    const parsed = await decodeRunFile(content);
    if (parsed === 'corrupt') corrupt.push(file.name);
    else if (parsed === 'newer') newer.push(file.name);
    else return replayRun(parsed, replay);
    return null;
  };
  const present = (runs: Array<HistoryRunFile | null>) => runs.filter((run): run is HistoryRunFile => run !== null);
  const [runs, latest] = await Promise.all([Promise.all(own.map(read)), Promise.all(others.map(read))]);
  const problems: string[] = [];
  if (corrupt.length > 0) problems.push(`skipped ${corrupt.length === 1 ? 'a corrupt run file' : `${corrupt.length} corrupt run files`}: ${named(corrupt.sort())}`);
  if (newer.length > 0) problems.push(`skipped ${newer.length === 1 ? 'a run file' : `${newer.length} run files`} written by a newer Loupe: ${named(newer.sort())}`);
  if (unreadable.length > 0) problems.push(`could not read ${named(unreadable.sort())}`);
  return { stream, runs: present(runs), others: present(latest), problems };
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
