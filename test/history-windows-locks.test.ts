import { closeSync, constants, existsSync, mkdtempSync, openSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readHistory } from '../src/core/history/read.js';
import { pruneHistory } from '../src/core/history/retain.js';
import { streamHash } from '../src/core/history/runFile.js';
import { writeRunFile } from '../src/core/history/write.js';
import { daysAgo, makeRunFile, putRunFile, readRunFile } from './helpers/history.js';

/**
 * Windows only: a file another process holds open blocks a rename onto it and
 * its removal, which is what the writer's rename retry and the warnings of the
 * reader and the pruner are for. Node always opens files sharing read, write
 * and delete, so a Loupe reader never blocks; an antivirus, the search indexer
 * or a backup tool does. libuv's `UV_FS_O_EXLOCK` (exclusive sharing, Windows
 * only, not exported by Node) opens a file the way they do, for real.
 * Elsewhere a rename never fails because the target is open: skipped.
 */
const EXLOCK = (constants as Record<string, number | undefined>)['UV_FS_O_EXLOCK'] ?? 0x10000000;
const LOCK_CODES = ['EPERM', 'EACCES', 'EBUSY'];
const NOW = Date.now();
const STREAM = { environment: 'staging', origin: 'ci' };

/** Holds a file exclusively, as an antivirus scanning it would; returns the release. */
function hold(file: string): () => void {
  const fd = openSync(file, constants.O_RDONLY | EXLOCK);
  let released = false;
  return () => {
    if (!released) closeSync(fd);
    released = true;
  };
}

describe.runIf(process.platform === 'win32')('history under Windows file locks', () => {
  let root: string;
  let dir: string;
  const releases: Array<() => void> = [];
  const held = (file: string) => {
    const release = hold(file);
    releases.push(release);
    return release;
  };
  const runs = () => readdirSync(path.join(dir, 'runs')).sort();

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'loupe-history-locks-'));
    dir = path.join(root, 'loupe-history');
  });
  afterEach(() => {
    for (const release of releases.splice(0)) release();
    rmSync(root, { recursive: true, force: true });
  });

  it('control: a plain rename onto a file held exclusively fails with a lock error', () => {
    const name = putRunFile(dir, makeRunFile({ id: 'r', startedAt: daysAgo(NOW, 1), stream: STREAM }));
    const other = path.join(dir, 'runs', '.other.tmp');
    writeFileSync(other, 'x');
    held(path.join(dir, 'runs', name));
    let code: string | undefined;
    try {
      renameSync(other, path.join(dir, 'runs', name));
    } catch (error) {
      code = (error as NodeJS.ErrnoException).code;
    }
    expect(LOCK_CODES).toContain(code);
  });

  it('a run file rewritten (a merge re-run) while it is held for a moment: the rename is retried and succeeds', async () => {
    const before = makeRunFile({ id: 'merge-1a2b3c4d', startedAt: daysAgo(NOW, 1), stream: STREAM, durationMs: 1 });
    const name = putRunFile(dir, before);
    const release = held(path.join(dir, 'runs', name));
    // Released after the first attempts failed: the retries wait 25, 50, 75 and 100 ms.
    setTimeout(release, 60);
    const file = await writeRunFile(dir, { ...before, run: { ...before.run, durationMs: 99 } });
    expect(path.basename(file)).toBe(name);
    expect(JSON.parse(readRunFile(file)).run.durationMs).toBe(99);
    expect(runs()).toEqual([name]);
  });

  it('held longer than the retries: the write throws the lock error, the old file is intact, no temporary file is left', async () => {
    const before = makeRunFile({ id: 'merge-1a2b3c4d', startedAt: daysAgo(NOW, 1), stream: STREAM, durationMs: 1 });
    const name = putRunFile(dir, before);
    const release = held(path.join(dir, 'runs', name));
    const error = await writeRunFile(dir, { ...before, run: { ...before.run, durationMs: 99 } }).then(
      () => null,
      (reason: NodeJS.ErrnoException) => reason,
    );
    release();
    expect(LOCK_CODES).toContain(error?.code);
    expect(runs()).toEqual([name]);
    expect(JSON.parse(readRunFile(path.join(dir, 'runs', name))).run.durationMs).toBe(1);
  });

  it('a window file held while it is read: named in a problem, the other files read, never a throw', async () => {
    putRunFile(dir, makeRunFile({ id: 'free', startedAt: daysAgo(NOW, 1), stream: STREAM }));
    const locked = putRunFile(dir, makeRunFile({ id: 'locked', startedAt: daysAgo(NOW, 2), stream: STREAM }));
    held(path.join(dir, 'runs', locked));
    const read = await readHistory(dir, streamHash(STREAM), (text) => text);
    expect(read.runs.map((run) => run.run.id)).toEqual(['free']);
    expect(read.problems).toEqual([`could not read runs/${locked}`]);
  });

  it('an old file held while it is pruned: the prune throws for the caller to warn, the other old files are removed', async () => {
    const keep = putRunFile(dir, makeRunFile({ id: 'new', startedAt: daysAgo(NOW, 1), stream: STREAM }));
    const locked = putRunFile(dir, makeRunFile({ id: 'old-locked', startedAt: daysAgo(NOW, 2), stream: STREAM }));
    const free = putRunFile(dir, makeRunFile({ id: 'old-free', startedAt: daysAgo(NOW, 3), stream: STREAM }));
    held(path.join(dir, 'runs', locked));
    const prune = { stream: streamHash(STREAM), maxRuns: 1, maxAgeDays: 90, now: NOW, keep };
    const error = await pruneHistory(dir, prune).then(
      () => null,
      (reason: NodeJS.ErrnoException) => reason,
    );
    expect(LOCK_CODES).toContain(error?.code);
    expect(existsSync(path.join(dir, 'runs', free))).toBe(false);
    expect(runs()).toEqual([keep, locked].sort());
  });
});
