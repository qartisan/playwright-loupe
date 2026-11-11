import { randomBytes } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { gzip as gzipCallback } from 'node:zlib';
import type { HistoryRunFile } from '../../schema/history-v1.js';
import { runFileName, streamHash } from './runFile.js';

/** Run files, one per run, under the history folder. */
export const RUNS_FOLDER = 'runs';
/** Written once, when Loupe creates the history folder: the history stays out of git without touching the project's `.gitignore`. */
export const GITIGNORE = '.gitignore';
const GITIGNORE_CONTENT = '*\n';
/** Temporary files start with a dot and end with this: readers skip them. */
export const TEMP_SUFFIX = '.tmp';

/** A temporary file of `writeRunFile`, left behind when a run was interrupted between the write and the rename. */
export function isTempFile(name: string): boolean {
  return name.startsWith('.') && name.endsWith(TEMP_SUFFIX);
}

/** Windows: a rename onto a file another process has open fails for a moment. */
const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_ATTEMPTS = 5;

const gzip = promisify(gzipCallback);

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= RENAME_ATTEMPTS || code === undefined || !RENAME_RETRY_CODES.has(code)) throw error;
      await delay(25 * attempt);
    }
  }
}

/**
 * Creates the history folder when it is missing, with its `.gitignore`. An
 * existing folder is left as it is: a project that removed the `.gitignore`
 * on purpose (to commit its history) does not get it back.
 */
export async function ensureHistoryFolder(dir: string): Promise<void> {
  const created = await mkdir(dir, { recursive: true });
  if (created !== undefined) {
    await writeFile(path.join(dir, GITIGNORE), GITIGNORE_CONTENT, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
  }
  await mkdir(path.join(dir, RUNS_FOLDER), { recursive: true });
}

/**
 * Writes a run file, gzipped at the default level, atomically: to a
 * temporary file in `runs/`, then renamed.
 * A reader sees the whole file or nothing; writing the same run again (a
 * merge re-run) replaces it. Returns the path written.
 */
export async function writeRunFile(dir: string, run: HistoryRunFile): Promise<string> {
  await ensureHistoryFolder(dir);
  const name = runFileName(run.run.startedAt, streamHash(run.run.stream), run.run.id);
  const target = path.join(dir, RUNS_FOLDER, name);
  const temp = path.join(dir, RUNS_FOLDER, `.${name}.${process.pid}-${randomBytes(4).toString('hex')}${TEMP_SUFFIX}`);
  const content = await gzip(JSON.stringify(run));
  try {
    await writeFile(temp, content);
    await renameWithRetry(temp, target);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
  return target;
}
