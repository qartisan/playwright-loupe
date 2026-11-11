import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TEMP_MAX_AGE_MS, planPrune, pruneHistory } from '../src/core/history/retain.js';
import { parseRunFileName, runFileName, streamHash, type RunFileName } from '../src/core/history/runFile.js';
import { writeRunFile } from '../src/core/history/write.js';
import { daysAgo, makeRunFile, putRunFile } from './helpers/history.js';

const NOW = Date.parse('2026-11-11T12:00:00.000Z');
const A = { environment: 'staging', origin: 'ci' };
const B = { environment: 'prod', origin: 'ci' };

function names(entries: Array<[days: number, stream: string, id: string]>): RunFileName[] {
  return entries.map(([days, stream, id]) => parseRunFileName(runFileName(daysAgo(NOW, days), stream, id)) as RunFileName);
}
const options = { stream: 'aaaaaaaa', maxRuns: 2, maxAgeDays: 90, now: NOW, keep: '' };
const ids = (removed: string[]) => removed.map((name) => (parseRunFileName(name) as RunFileName).runId);

describe('planPrune', () => {
  it('maxRuns: beyond the newest runs of the own stream only', () => {
    const files = names([
      [1, 'aaaaaaaa', 'a1'],
      [2, 'aaaaaaaa', 'a2'],
      [3, 'aaaaaaaa', 'a3'],
      [4, 'aaaaaaaa', 'a4'],
      [1, 'bbbbbbbb', 'b1'],
      [2, 'bbbbbbbb', 'b2'],
      [3, 'bbbbbbbb', 'b3'],
    ]);
    expect(ids(planPrune(files, options)).sort()).toEqual(['a3', 'a4']);
  });

  it('maxAgeDays: in every stream, the abandoned ones included', () => {
    const files = names([
      [1, 'aaaaaaaa', 'a1'],
      [91, 'aaaaaaaa', 'a-old'],
      [91, 'bbbbbbbb', 'b-old'],
      [89, 'bbbbbbbb', 'b-kept'],
    ]);
    expect(ids(planPrune(files, { ...options, maxRuns: 200 })).sort()).toEqual(['a-old', 'b-old']);
  });

  it('never removes the file just written, even when it is old', () => {
    const files = names([
      [1, 'aaaaaaaa', 'a1'],
      [2, 'aaaaaaaa', 'a2'],
      [100, 'aaaaaaaa', 'merged-old-blobs'],
    ]);
    const keep = (files[2] as RunFileName).name;
    expect(planPrune(files, { ...options, keep })).toEqual([]);
  });
});

describe('pruneHistory', () => {
  let dir: string;
  beforeEach(() => {
    dir = path.join(mkdtempSync(path.join(tmpdir(), 'loupe-history-retain-')), 'loupe-history');
    mkdirSync(path.join(dir, 'runs'), { recursive: true });
  });
  afterEach(() => {
    rmSync(path.dirname(dir), { recursive: true, force: true });
  });
  const listing = () => readdirSync(path.join(dir, 'runs')).sort();

  it('removes temporary files older than an hour, keeps younger ones and files it does not know', async () => {
    const stale = path.join(dir, 'runs', '.x.json.1-aa.tmp');
    const fresh = path.join(dir, 'runs', '.y.json.2-bb.tmp');
    writeFileSync(stale, '{');
    writeFileSync(fresh, '{');
    writeFileSync(path.join(dir, 'runs', 'notes.json'), '{}');
    const hourAndMinute = (NOW - TEMP_MAX_AGE_MS - 60_000) / 1000;
    utimesSync(stale, hourAndMinute, hourAndMinute);
    const minuteAgo = (NOW - 60_000) / 1000;
    utimesSync(fresh, minuteAgo, minuteAgo);
    expect(await pruneHistory(dir, { ...options, stream: streamHash(A) })).toEqual(['.x.json.1-aa.tmp']);
    expect(listing()).toEqual(['.y.json.2-bb.tmp', 'notes.json']);
  });

  it('several runs pruning the same folder at once: no error, each file removed once', async () => {
    for (let day = 1; day <= 6; day++) putRunFile(dir, makeRunFile({ id: `a${day}`, startedAt: daysAgo(NOW, day), stream: A }));
    for (let day = 1; day <= 4; day++) putRunFile(dir, makeRunFile({ id: `b${day}`, startedAt: daysAgo(NOW, day), stream: B }));
    const prune = { ...options, stream: streamHash(A) };
    const results = await Promise.all(Array.from({ length: 8 }, () => pruneHistory(dir, prune)));
    expect(ids(results.flat()).sort()).toEqual(['a3', 'a4', 'a5', 'a6']);
    expect(listing().map((name) => (parseRunFileName(name) as RunFileName).runId).sort()).toEqual(['a1', 'a2', 'b1', 'b2', 'b3', 'b4']);
  });

  it('two streams writing and pruning the same folder at once lose nothing of each other', async () => {
    const maxRuns = 3;
    const round = (stream: typeof A, label: string, index: number) =>
      writeRunFile(dir, makeRunFile({ id: `${label}${index}`, startedAt: new Date(NOW - (100 - index) * 1000).toISOString(), stream })).then((file) =>
        pruneHistory(dir, { stream: streamHash(stream), maxRuns, maxAgeDays: 90, now: NOW, keep: path.basename(file) }),
      );
    await Promise.all(Array.from({ length: 10 }, (_, index) => [round(A, 'a', index), round(B, 'b', index)]).flat());
    const left = listing().map((name) => parseRunFileName(name) as RunFileName);
    for (const stream of [A, B]) {
      const own = left.filter((file) => file.stream === streamHash(stream));
      // A prune removes a file only when it saw maxRuns newer ones of its stream: the newest are never lost.
      expect(own.length).toBeGreaterThanOrEqual(maxRuns);
    }
    // A final prune of each stream converges on exactly the newest maxRuns.
    for (const stream of [A, B]) await pruneHistory(dir, { stream: streamHash(stream), maxRuns, maxAgeDays: 90, now: NOW, keep: '' });
    const final = listing().map((name) => (parseRunFileName(name) as RunFileName).runId).sort();
    expect(final).toEqual(['a7', 'a8', 'a9', 'b7', 'b8', 'b9']);
  });

  it('a folder that cannot be listed throws, for the caller to warn', async () => {
    rmSync(path.join(dir, 'runs'), { recursive: true });
    await expect(pruneHistory(dir, options)).rejects.toThrow();
  });
});
