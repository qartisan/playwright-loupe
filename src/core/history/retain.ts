import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { parseRunFileName, type RunFileName } from './runFile.js';
import { RUNS_FOLDER, isTempFile } from './write.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** A temporary file older than this was left by an interrupted run: removed. */
export const TEMP_MAX_AGE_MS = 60 * 60 * 1000;

export interface RetentionOptions {
  /** Stream hash of the run that prunes. */
  stream: string;
  maxRuns: number;
  maxAgeDays: number;
  now: number;
  /** The run file just written: never removed, even when it is old (a merge of old blobs). */
  keep: string;
}

/**
 * The run files to remove, from names alone:
 *
 * - beyond the `maxRuns` newest runs of the run's own stream: another stream
 *   keeps its runs whatever this one does;
 * - older than `maxAgeDays`, in every stream: the runs of an abandoned stream
 *   (an old stream key, an environment that is gone) do not stay forever.
 */
export function planPrune(files: readonly RunFileName[], options: RetentionOptions): string[] {
  const remove = new Set<string>();
  const own = files
    .filter((file) => file.stream === options.stream)
    .sort((a, b) => b.startedAt - a.startedAt || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  for (const file of own.slice(options.maxRuns)) remove.add(file.name);
  const cutoff = options.now - options.maxAgeDays * DAY_MS;
  for (const file of files) if (file.startedAt < cutoff) remove.add(file.name);
  remove.delete(options.keep);
  return [...remove].sort();
}

const code = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | null)?.code;

/** Windows: removing a file another process holds open (an antivirus, the indexer, a reader) fails. */
const HELD_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

/**
 * Whether a removal failed because Windows holds the file: the file is left
 * for the next run's prune, which plans it again from the names. Elsewhere
 * these codes mean a permission problem that will not go away on its own,
 * which is worth a warning.
 */
export function isHeldFile(error: unknown, platform: NodeJS.Platform = process.platform): boolean {
  const value = code(error);
  return platform === 'win32' && value !== undefined && HELD_CODES.has(value);
}

/**
 * Applies the retention to the history folder, then removes the temporary
 * files older than an hour. Another run may be pruning the same folder: a
 * file already gone is no error, nor, on Windows, a file another process
 * holds (it goes at the next run). Any other failure is thrown after every
 * removal was tried. Returns the names removed.
 */
export async function pruneHistory(dir: string, options: RetentionOptions): Promise<string[]> {
  const runs = path.join(dir, RUNS_FOLDER);
  const names = await readdir(runs);
  const files = names.map(parseRunFileName).filter((file): file is RunFileName => file !== null);
  const removed: string[] = [];
  let failure: unknown = null;
  const remove = async (name: string): Promise<void> => {
    try {
      await unlink(path.join(runs, name));
      removed.push(name);
    } catch (error) {
      if (code(error) !== 'ENOENT' && !isHeldFile(error)) failure ??= error;
    }
  };
  await Promise.all(planPrune(files, options).map(remove));
  await Promise.all(
    names.filter(isTempFile).map(async (name) => {
      try {
        const { mtimeMs } = await stat(path.join(runs, name));
        if (options.now - mtimeMs > TEMP_MAX_AGE_MS) await remove(name);
      } catch (error) {
        if (code(error) !== 'ENOENT') failure ??= error;
      }
    }),
  );
  if (failure !== null) throw failure;
  return removed.sort();
}
