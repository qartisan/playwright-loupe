import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LoupeReport } from '../src/schema/v1.js';
import { LOAD_ERROR_CONFIG, ROOT, assertBuilt, readReport } from './helpers/fixtures.js';

const CLI = path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
const CYCLES = 3;

/**
 * The VS Code extension, UI mode and watch mode run every cycle through one
 * long-lived `test-server`. Loupe keeps run state (run errors, run id) on the
 * reporter instance and never resets it in `onBegin`: this is correct only
 * because Playwright creates new config reporters for every `runTests`
 * (checked in 1.52, 1.58, 1.64 and 1.65). This guard fails if a Playwright
 * version starts reusing one reporter across cycles, so that a cycle's report
 * would carry the run errors of the cycles before it. History relies on the
 * same assumption: one reporter, one run file.
 */
describe('test-server cycles: each report holds only its own run', () => {
  let workDir: string;
  const reports: LoupeReport[] = [];

  beforeAll(async () => {
    assertBuilt();
    workDir = mkdtempSync(path.join(tmpdir(), 'loupe-cycles-'));
    const output = path.join(workDir, 'report');
    const cacheDir = path.join(workDir, 'pw-cache');
    const child = spawn(process.execPath, [CLI, 'test-server', '-c', LOAD_ERROR_CONFIG, '--host', '127.0.0.1'], {
      cwd: ROOT,
      env: { ...process.env, PWTEST_CACHE_DIR: cacheDir, LOUPE_FIXTURE_OUTPUT: output },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    child.stderr.on('data', (chunk: Buffer) => (log += chunk.toString()));
    try {
      const url = await new Promise<string>((resolve, reject) => {
        child.stdout.on('data', (chunk: Buffer) => {
          log += chunk.toString();
          const match = /Listening on (ws:\/\/\S+)/.exec(log);
          if (match) resolve(match[1] as string);
        });
        child.on('exit', () => reject(new Error(`test-server exited.\n${log}`)));
      });
      const socket = new WebSocket(url);
      await new Promise((resolve) => socket.addEventListener('open', resolve));
      let id = 0;
      const pending = new Map<number, (message: unknown) => void>();
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data)) as { id?: number };
        if (message.id !== undefined) pending.get(message.id)?.(message);
      });
      const call = (method: string, params: unknown) =>
        new Promise((resolve) => {
          pending.set(++id, resolve);
          socket.send(JSON.stringify({ id, method, params }));
        });
      await call('initialize', { closeOnDisconnect: true });
      for (let cycle = 1; cycle <= CYCLES; cycle++) {
        await call('runTests', { locations: [] });
        // Each cycle rewrites the same report folder: read it before the next one.
        reports.push(readReport(output, `Cycle ${cycle}.\n${log}`));
      }
      socket.close();
    } finally {
      child.kill();
    }
  }, 120_000);

  afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it(`runs ${CYCLES} cycles, each with a new run id`, () => {
    expect(reports).toHaveLength(CYCLES);
    expect(new Set(reports.map((report) => report.run.id)).size).toBe(CYCLES);
  });

  it('every cycle reports the load error once, not the errors of the cycles before', () => {
    const messages = reports.map((report) => report.run.errors.map((error) => error.message));
    expect(messages[0]).toHaveLength(1);
    expect(messages[0]?.[0]).toMatch(/^Error: Cannot find module '.*missing-helper\.js'/);
    for (const cycle of messages.slice(1)) expect(cycle).toEqual(messages[0]);
  });
});
