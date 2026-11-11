import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RUNS_FOLDER, TEMP_SUFFIX, writeRunFile } from '../src/core/history/write.js';
import type { HistoryRunFile } from '../src/schema/history-v1.js';

// Spies on the writer's file system calls; everything still reaches the disk.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, writeFile: vi.fn(actual.writeFile), rename: vi.fn(actual.rename) };
});

const RUN: HistoryRunFile = {
  historyVersion: 1,
  signatureVersion: 6,
  loupeVersion: '0.4.0',
  playwrightVersion: '1.64.1',
  run: {
    id: 'merge-1a2b3c4d',
    reportRunId: '6f1c2b9e-8d3a-4c5b-9e7f-1a2b3c4d5e6f',
    startedAt: '2026-11-10T14:02:11.408Z',
    durationMs: 1,
    status: 'passed',
    origin: 'local',
    environment: 'default',
    stream: { environment: 'default', origin: 'local' },
    scope: 'full',
    scopeReasons: [],
    merged: true,
    excluded: null,
    ciProvider: null,
    git: { commit: null, branch: null },
    stats: { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0 },
    projects: [],
    errors: [],
  },
  tests: [],
};

describe('writeRunFile is atomic', () => {
  let root: string | undefined;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('writes a hidden temporary file in runs/, then renames it onto the run file', async () => {
    root = mkdtempSync(path.join(tmpdir(), 'loupe-history-atomic-'));
    const dir = path.join(root, 'loupe-history');
    const target = await writeRunFile(dir, RUN);

    const runsDir = path.join(dir, RUNS_FOLDER);
    const writes = vi.mocked(fs.writeFile).mock.calls.map(([file]) => String(file)).filter((file) => path.dirname(file) === runsDir);
    expect(writes).toHaveLength(1);
    const temp = writes[0] as string;
    expect(path.basename(temp).startsWith('.')).toBe(true);
    expect(temp.endsWith(TEMP_SUFFIX)).toBe(true);
    expect(vi.mocked(fs.rename).mock.calls.map(([from, to]) => [String(from), String(to)])).toEqual([[temp, target]]);
  });

  const lockError = (code: string) => Object.assign(new Error(`${code}: operation not permitted, rename`), { code });

  it.each(['EPERM', 'EACCES', 'EBUSY'])('retries a rename that fails with %s (Windows: the target is open elsewhere), then succeeds', async (code) => {
    root = mkdtempSync(path.join(tmpdir(), 'loupe-history-atomic-'));
    const dir = path.join(root, 'loupe-history');
    vi.mocked(fs.rename).mockRejectedValueOnce(lockError(code)).mockRejectedValueOnce(lockError(code));
    const target = await writeRunFile(dir, RUN);
    expect(vi.mocked(fs.rename)).toHaveBeenCalledTimes(3);
    expect(readdirSync(path.join(dir, RUNS_FOLDER))).toEqual([path.basename(target)]);
  });

  it('gives up after five attempts, throws the lock error and leaves no temporary file', async () => {
    root = mkdtempSync(path.join(tmpdir(), 'loupe-history-atomic-'));
    const dir = path.join(root, 'loupe-history');
    for (let attempt = 0; attempt < 5; attempt++) vi.mocked(fs.rename).mockRejectedValueOnce(lockError('EPERM'));
    await expect(writeRunFile(dir, RUN)).rejects.toMatchObject({ code: 'EPERM' });
    expect(vi.mocked(fs.rename)).toHaveBeenCalledTimes(5);
    expect(readdirSync(path.join(dir, RUNS_FOLDER))).toEqual([]);
  });

  it('does not retry other errors', async () => {
    root = mkdtempSync(path.join(tmpdir(), 'loupe-history-atomic-'));
    const dir = path.join(root, 'loupe-history');
    vi.mocked(fs.rename).mockRejectedValueOnce(lockError('ENOSPC'));
    await expect(writeRunFile(dir, RUN)).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(vi.mocked(fs.rename)).toHaveBeenCalledTimes(1);
    expect(readdirSync(path.join(dir, RUNS_FOLDER))).toEqual([]);
  });
});
