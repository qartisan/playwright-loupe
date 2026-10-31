import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { countRequired, describeBad, runCommand, runRows, selectedExpected, type Launch, type Row } from '../fixtures/windows-check/harness.mjs';
import { ROOT } from './helpers/fixtures.js';

/** The Windows job only runs for its paths, so a renamed file would silently stop triggering it. */
describe('windows-check workflow', () => {
  const workflow = readFileSync(path.join(ROOT, '.github/workflows/windows-check.yml'), 'utf8');
  const paths = [...workflow.matchAll(/^ {6}- ([^\s#]+)$/gm)].map((match) => match[1] ?? '');

  it('triggers on paths that exist', () => {
    expect(paths).toContain('src/renderer/detail/rerun.ts');
    expect(paths).toContain('fixtures/windows-check/**');
    // What produces the file, title, project and tags of a test: a change there can break Windows only.
    for (const file of ['src/core/identity.ts', 'src/core/build.ts', 'src/core/paths.ts']) expect(paths).toContain(file);
    for (const pattern of paths) expect(globSync(pattern, { cwd: ROOT }).length, pattern).toBeGreaterThan(0);
  });

  it('is triggered by the same paths on push and pull request, and weekly', () => {
    const listOf = (event: string): string => workflow.match(new RegExp(`^ {2}${event}:\\n {4}paths:\\n((?: {6}- .*\\n)+)`, 'm'))?.[1] ?? '';
    expect(listOf('push')).not.toBe('');
    expect(listOf('pull_request')).toBe(listOf('push'));
    expect(workflow).toMatch(/^ {2}schedule:$/m);
  });

  it('fails when a shell is missing instead of skipping it', () => {
    expect(workflow).toContain('node check.mjs --require-all-shells');
    expect(workflow).toContain('runs-on: windows-latest');
  });

  it('measures only in a manual run that asks for it, off by default', () => {
    const parsed = workflow.match(/^ {2}workflow_dispatch:\n {4}inputs:\n {6}measure:\n(?: {8}.*\n)+/m)?.[0] ?? '';
    expect(parsed).toContain('type: boolean');
    expect(parsed).toContain('default: false');
    // The flag once, behind the event: push, pull request and schedule cannot turn it on.
    expect(workflow.match(/--measure/g)).toHaveLength(1);
    expect(workflow).toContain("${{ github.event_name == 'workflow_dispatch' && inputs.measure && '--measure' || '' }}");
  });

  it('runs a file the workflow names', () => {
    for (const file of ['check-checkout.mjs', 'build.mjs', 'check.mjs', 'harness.mjs', 'setup.mjs']) expect(existsSync(path.join(ROOT, 'fixtures/windows-check', file)), file).toBe(true);
  });
});

describe('windows-check harness', () => {
  const LAUNCH: Launch = ['shell', ['-c', 'npx playwright test'], {}];
  const KEY = JSON.stringify(['main', 'a.spec.ts', 't']);

  /** A child process: what it prints, then how it ends. */
  function fakeChild(script: (child: EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }) => void): unknown {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
    setImmediate(() => script(child));
    return child;
  }
  const selecting = (keys: string[]) => () =>
    fakeChild((child) => {
      child.stdout.emit('data', `noise\r\nLOUPE_SELECTION ${JSON.stringify(keys.map((key) => JSON.parse(key)))}\r\n`);
      child.emit('close', 0);
    });
  const throwing = (code: string) => () => {
    throw Object.assign(new Error(`spawn ${code}`), { code });
  };
  const emittingError = (code: string) => () => fakeChild((child) => child.emit('error', Object.assign(new Error(`spawn ${code}`), { code })));
  const row = (form: string, required: boolean, text = 'npx short'): Row => ({ form, required, expected: [KEY], text });
  const toLaunch = (text: string): Launch => ['shell', ['-c', text], {}];

  describe('runCommand', () => {
    it('reads the selection', async () => {
      expect(await runCommand(LAUNCH, {}, selecting([KEY]))).toEqual({ selected: [KEY] });
    });

    it('resolves with the code when spawn throws, instead of rejecting', async () => {
      expect(await runCommand(LAUNCH, {}, throwing('ENAMETOOLONG'))).toMatchObject({ code: 'ENAMETOOLONG', message: 'spawn ENAMETOOLONG' });
    });

    it('resolves with the code when the child emits error', async () => {
      expect(await runCommand(LAUNCH, {}, emittingError('ENOENT'))).toMatchObject({ code: 'ENOENT' });
    });

    it('keeps the error when close follows it', async () => {
      const spawnFn = (): unknown =>
        fakeChild((child) => {
          child.emit('error', Object.assign(new Error('spawn E2BIG'), { code: 'E2BIG' }));
          child.emit('close', -1);
        });
      expect(await runCommand(LAUNCH, {}, spawnFn)).toMatchObject({ code: 'E2BIG' });
    });

    it('gives what was printed when there is no selection, and survives a broken one', async () => {
      const printing = (text: string) => (): unknown =>
        fakeChild((child) => {
          child.stderr.emit('data', text);
          child.emit('close', 1);
        });
      expect(await runCommand(LAUNCH, {}, printing('The command line is too long.'))).toEqual({ raw: 'The command line is too long.' });
      expect(await runCommand(LAUNCH, {}, printing('LOUPE_SELECTION {broken'))).toMatchObject({ code: 'BAD_OUTPUT' });
    });

    it.skipIf(process.platform === 'win32')('resolves on a real refusal by the system', async () => {
      const refused = await runCommand(['bash', ['-c', `# ${'x'.repeat(200_000)}`], {}], {}, spawn);
      expect(refused.code).toBe('E2BIG');
    });
  });

  describe('runRows', () => {
    /** Refuses a command above `limit` characters, as Windows does; selects the expected test otherwise. */
    const refusingAbove = (limit: number, fail: (code: string) => () => unknown) => (_command: string, args: string[]) =>
      (args[1] ?? '').length > limit ? fail('ENAMETOOLONG')() : selecting([KEY])();

    it.each([
      ['throws', throwing],
      ['emits error', emittingError],
    ] as const)('reports a measure row refused when spawn %s, and runs every other row', async (_how, fail) => {
      const long = 'x'.repeat(36_000);
      const commands = [row('one test', true), row('length 36,000', false, long), row('one test', true), row('one test', true), row('many tests', true), row('one test', true)];
      const stats = await runRows({ commands, toLaunch, spawnFn: refusingAbove(1000, fail), concurrency: 2 });

      expect(stats['one test']).toMatchObject({ required: true, ok: 4, bad: [] });
      expect(stats['many tests']).toMatchObject({ ok: 1, bad: [] });
      expect(stats['length 36,000']?.ok).toBe(0);
      const [refused] = stats['length 36,000']?.bad ?? [];
      expect(refused).toMatchObject({ code: 'ENAMETOOLONG', length: 36_000, selected: 'error' });
      expect(describeBad(refused!)).toMatch(/^refused by the system at 360\d\d characters \(ENAMETOOLONG\), for a command of 36000$/);
      // A measure row never counts.
      expect(countRequired(stats)).toEqual({ bad: 0, run: 5 });
    });

    it.each([
      ['throws', throwing],
      ['emits error', emittingError],
    ] as const)('counts a REQUIRED row as bad when spawn %s, and runs every other row', async (_how, fail) => {
      const commands = [row('one test', true), row('one test', true, 'x'.repeat(2000)), row('one test', true)];
      const stats = await runRows({ commands, toLaunch, spawnFn: refusingAbove(1000, fail), concurrency: 1 });
      expect(stats['one test']).toMatchObject({ ok: 2 });
      expect(stats['one test']?.bad[0]).toMatchObject({ code: 'ENAMETOOLONG' });
      expect(countRequired(stats)).toEqual({ bad: 1, run: 3 });
    });

    it('finishes when every launch fails, disposing each worker', async () => {
      let disposed = 0;
      const stats = await runRows({
        commands: [row('one test', true), row('one test', true)],
        toLaunch,
        spawnFn: throwing('EACCES'),
        worker: () => ({ env: {}, dispose: () => (disposed += 1) }),
        concurrency: 3,
      });
      expect(countRequired(stats)).toEqual({ bad: 2, run: 2 });
      expect(disposed).toBe(3);
      expect(describeBad(stats['one test']!.bad[0]!)).toMatch(/^could not start \(EACCES\)/);
    });

    it('counts a wrong selection as bad, not as a launch failure', async () => {
      const stats = await runRows({ commands: [row('one test', true)], toLaunch, spawnFn: selecting([]), concurrency: 1 });
      expect(countRequired(stats)).toEqual({ bad: 1, run: 1 });
      expect(describeBad(stats['one test']!.bad[0]!)).toBe('length 9, selected 0 of 1');
    });
  });

  it('ignores the setup project selected as a dependency, but not another project', () => {
    const setup = JSON.stringify(['setup', 'a.setup.ts', 's']);
    const other = JSON.stringify(['other', 'a.spec.ts', 't']);
    expect(selectedExpected({ expected: [KEY] }, [KEY, setup])).toBe(true);
    expect(selectedExpected({ expected: [KEY] }, [KEY, other])).toBe(false);
    expect(selectedExpected({ expected: [KEY] }, undefined)).toBe(false);
  });
});
