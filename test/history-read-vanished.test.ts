import { mkdtempSync, rmSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readHistory } from '../src/core/history/read.js';
import { streamHash } from '../src/core/history/runFile.js';
import { daysAgo, makeRunFile, putRunFile } from './helpers/history.js';

// readFile can be made to fail for one file; everything else reaches the disk.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

const NOW = Date.parse('2026-11-11T12:00:00.000Z');
const STREAM = { environment: 'staging', origin: 'ci' };

function failOn(name: string, code: string): void {
  const actual = vi.mocked(fs.readFile).getMockImplementation() as typeof fs.readFile;
  vi.mocked(fs.readFile).mockImplementation(((file: Parameters<typeof fs.readFile>[0], ...rest: unknown[]) => {
    if (path.basename(String(file)) === name) return Promise.reject(Object.assign(new Error(`${code}: ${name}`), { code }));
    return (actual as (...args: unknown[]) => unknown)(file, ...rest);
  }) as typeof fs.readFile);
}

describe('readHistory and files changing under it', () => {
  let root: string | undefined;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    vi.mocked(fs.readFile).mockReset();
  });

  const setup = () => {
    root = mkdtempSync(path.join(tmpdir(), 'loupe-history-vanished-'));
    const dir = path.join(root, 'loupe-history');
    putRunFile(dir, makeRunFile({ id: 'kept', startedAt: daysAgo(NOW, 1), stream: STREAM }));
    const gone = putRunFile(dir, makeRunFile({ id: 'gone', startedAt: daysAgo(NOW, 2), stream: STREAM }));
    return { dir, gone };
  };

  it('a file removed between the listing and the read (retention by another run) is skipped without a word', async () => {
    const { dir, gone } = setup();
    failOn(gone, 'ENOENT');
    const read = await readHistory(dir, streamHash(STREAM), (text) => text);
    expect([read.runs.map((run) => run.run.id), read.problems, read.skipped]).toEqual([['kept'], [], 0]);
  });

  // A file Windows holds while it is read keeps its warning: a data point is missing from the report.
  it.each(['EACCES', 'EPERM', 'EBUSY', 'EIO'])('a file that cannot be read (%s) is skipped and named', async (code) => {
    const { dir, gone } = setup();
    failOn(gone, code);
    const read = await readHistory(dir, streamHash(STREAM), (text) => text);
    expect([read.runs.map((run) => run.run.id), read.problems, read.skipped]).toEqual([['kept'], [`could not read runs/${gone}`], 1]);
  });
});
