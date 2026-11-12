import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isHeldFile, pruneHistory } from '../src/core/history/retain.js';
import { streamHash } from '../src/core/history/runFile.js';
import { daysAgo, makeRunFile, putRunFile } from './helpers/history.js';

// unlink can be made to fail for one file; everything else reaches the disk.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, unlink: vi.fn(actual.unlink) };
});

const NOW = Date.parse('2026-11-11T12:00:00.000Z');
const STREAM = { environment: 'staging', origin: 'ci' };
const PLATFORM = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

function failOn(name: string, code: string): void {
  const actual = vi.mocked(fs.unlink).getMockImplementation() as typeof fs.unlink;
  vi.mocked(fs.unlink).mockImplementation(((file: Parameters<typeof fs.unlink>[0]) => {
    if (path.basename(String(file)) === name) return Promise.reject(Object.assign(new Error(`${code}: ${name}`), { code }));
    return actual(file);
  }) as typeof fs.unlink);
}

describe('isHeldFile', () => {
  const error = (code: string) => Object.assign(new Error(code), { code });
  it.each(['EPERM', 'EACCES', 'EBUSY'])('%s on Windows: held', (code) => {
    expect(isHeldFile(error(code), 'win32')).toBe(true);
  });
  it.each(['EPERM', 'EACCES', 'EBUSY'])('%s elsewhere: a real permission problem', (code) => {
    expect([isHeldFile(error(code), 'linux'), isHeldFile(error(code), 'darwin')]).toEqual([false, false]);
  });
  it.each(['EIO', 'ENOSPC', 'EROFS'])('%s on Windows: not held', (code) => {
    expect(isHeldFile(error(code), 'win32')).toBe(false);
  });
  it('an error without a code, or no error: not held', () => {
    expect([isHeldFile(new Error('x'), 'win32'), isHeldFile(null, 'win32')]).toEqual([false, false]);
  });
});

describe('pruneHistory and a file that cannot be removed', () => {
  let root: string;
  let dir: string;
  let keep: string;
  let locked: string;
  let free: string;
  const runs = () => readdirSync(path.join(dir, 'runs')).sort();
  const prune = () => pruneHistory(dir, { stream: streamHash(STREAM), maxRuns: 1, maxAgeDays: 90, now: NOW, keep });

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'loupe-history-retain-locks-'));
    dir = path.join(root, 'loupe-history');
    keep = putRunFile(dir, makeRunFile({ id: 'new', startedAt: daysAgo(NOW, 1), stream: STREAM }));
    locked = putRunFile(dir, makeRunFile({ id: 'old-locked', startedAt: daysAgo(NOW, 2), stream: STREAM }));
    free = putRunFile(dir, makeRunFile({ id: 'old-free', startedAt: daysAgo(NOW, 3), stream: STREAM }));
  });
  afterEach(() => {
    setPlatform(PLATFORM);
    vi.mocked(fs.unlink).mockReset();
    rmSync(root, { recursive: true, force: true });
  });

  it.each(['EPERM', 'EACCES', 'EBUSY'])('held by Windows (%s): skipped without a word, removed at the next prune', async (code) => {
    setPlatform('win32');
    failOn(locked, code);
    expect(await prune()).toEqual([free]);
    expect(runs()).toEqual([keep, locked].sort());
    vi.mocked(fs.unlink).mockReset();
    expect(await prune()).toEqual([locked]);
    expect(runs()).toEqual([keep]);
  });

  it('another failure on Windows: thrown for the caller to warn, after the other removals', async () => {
    setPlatform('win32');
    failOn(locked, 'EIO');
    await expect(prune()).rejects.toMatchObject({ code: 'EIO' });
    expect(runs()).toEqual([keep, locked].sort());
  });

  it.each(['EPERM', 'EACCES'])('%s outside Windows: a permission problem, thrown for the caller to warn', async (code) => {
    setPlatform('linux');
    failOn(locked, code);
    await expect(prune()).rejects.toMatchObject({ code });
    expect(runs()).toEqual([keep, locked].sort());
  });
});
