import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { runFileName, streamHash } from '../../src/core/history/runFile.js';
import type { HistoryRun, HistoryRunFile } from '../../src/schema/history-v1.js';

/** A valid run file of one passed test; `run` overrides the run metadata. */
export function makeRunFile(run: Partial<HistoryRun> = {}, tests: HistoryRunFile['tests'] = [{ id: 't1', t: ['p', 'a.spec.ts', 'passes'], o: 'P', d: 5 }]): HistoryRunFile {
  return {
    historyVersion: 1,
    signatureVersion: 6,
    loupeVersion: '0.4.0',
    playwrightVersion: '1.64.1',
    run: {
      id: 'run-1',
      reportRunId: '00000000-0000-4000-8000-000000000000',
      startedAt: '2026-11-10T10:00:00.000Z',
      durationMs: 1,
      status: 'passed',
      origin: 'local',
      environment: 'default',
      stream: { environment: 'default', origin: 'local' },
      scope: 'full',
      scopeReasons: [],
      merged: false,
      excluded: null,
      ciProvider: null,
      git: { commit: null, branch: null },
      stats: { total: 1, passed: 1, failed: 0, flaky: 0, skipped: 0 },
      projects: [{ name: 'p', retries: 0 }],
      errors: [],
      ...run,
    },
    tests,
  };
}

/**
 * Writes a run file under `<dir>/runs/` with its real name, gzipped as Loupe
 * writes it. A string `content` is gzipped instead of the file (a corrupt or
 * newer JSON); a Buffer is written as it is (a file that does not decompress).
 * Returns the name.
 */
export function putRunFile(dir: string, file: HistoryRunFile, content?: string | Buffer): string {
  const name = runFileName(file.run.startedAt, streamHash(file.run.stream), file.run.id);
  mkdirSync(path.join(dir, 'runs'), { recursive: true });
  writeFileSync(path.join(dir, 'runs', name), Buffer.isBuffer(content) ? content : gzipSync(content ?? JSON.stringify(file)));
  return name;
}

/** The JSON text of a run file on disk, decompressed. */
export function readRunFile(file: string): string {
  return gunzipSync(readFileSync(file)).toString('utf8');
}

/** An ISO date `days` days before `now`. */
export function daysAgo(now: number, days: number): string {
  return new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
}
