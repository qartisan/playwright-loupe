import { describe, expect, it } from 'vitest';
import { deriveEmbedded } from '../src/core/history/embed.js';
import { EMBEDDED_EXTRACTS, type HistoryRunFile, type HistoryTest } from '../src/schema/history-v1.js';
import type { LoupeReport } from '../src/schema/v1.js';
import { NO_NOTES, makeRunFile } from './helpers/history.js';

const STREAM = { environment: 'staging', origin: 'ci' };
const OPTIONS = { include: 'full' as const, stream: STREAM, current: { origin: 'ci' as const, excluded: null, id: 'current' }, currentRunId: 'current', ...NO_NOTES };

/** Only what the derivation reads from the report: its tests, in order. */
const report = (...tests: Array<[id: string, repeatEachIndex?: number]>) =>
  ({ tests: tests.map(([id, repeatEachIndex = 0]) => ({ id, repeatEachIndex })) }) as unknown as LoupeReport;

const row = (id: string, o: HistoryTest['o'], extra: Partial<HistoryTest> = {}): HistoryTest => ({ id, t: ['p', 'a.spec.ts', id], o, d: 1, ...extra });
const failed = (id: string, sig: string, a = 'FF', o: HistoryTest['o'] = 'F'): HistoryTest => row(id, o, { a, f: [{ i: 0, sig: [sig], cat: 'Assertion', x: `extract of ${sig}`, at: null }] });
const run = (id: string, day: number, tests: HistoryTest[], extra: Partial<HistoryRunFile> = {}): HistoryRunFile => ({
  ...makeRunFile({ id, startedAt: `2026-11-${String(day).padStart(2, '0')}T10:00:00.000Z`, stream: STREAM }, tests),
  ...extra,
});

describe('deriveEmbedded: loupe.notes.json', () => {
  const window = { runs: [run('r2', 2, [row('a', 'P')]), run('r1', 1, [row('a', 'F')])], others: [], skipped: 0 };
  const notes = new Map([
    ['r1', { notesExcluded: 'staging down', note: 'VPN' }],
    ['r2', { note: 'after the refactor' }],
    ['purged', { notesExcluded: 'not in the window' }],
  ]);

  it('adds what the file says to the runs it names, and nothing to the others', () => {
    const value = deriveEmbedded(report(['a']), window, { ...OPTIONS, notes, notesFile: 'read' });
    expect(value?.runs.map(({ id, excluded, notesExcluded, note }) => ({ id, excluded, notesExcluded, note }))).toEqual([
      { id: 'r1', excluded: null, notesExcluded: 'staging down', note: 'VPN' },
      { id: 'r2', excluded: null, notesExcluded: undefined, note: 'after the refactor' },
    ]);
    // Omitted, not undefined or null, when the file has nothing: no byte for a run without notes.
    expect(Object.keys(value?.runs[1] ?? {})).not.toContain('notesExcluded');
    expect(value?.notesFile).toBe('read');
  });

  it('without notes, no key is added', () => {
    const value = deriveEmbedded(report(['a']), window, OPTIONS);
    expect(JSON.stringify(value)).not.toMatch(/notesExcluded|"note"/);
    expect([value?.notesFile, value?.current]).toEqual(['absent', OPTIONS.current]);
  });

  it('keeps both reasons of a run excluded at launch and in the file', () => {
    const launch = { runs: [run('r1', 1, [row('a', 'F')], { run: { ...makeRunFile({ id: 'r1', stream: STREAM }).run, excluded: { reason: 'restore' } } })], others: [], skipped: 0 };
    const value = deriveEmbedded(report(['a']), launch, { ...OPTIONS, notes, notesFile: 'read' });
    expect([value?.runs[0]?.excluded, value?.runs[0]?.notesExcluded]).toEqual(['restore', 'staging down']);
  });

  it('gives the current run its notes when the file names its id (a merge or CI job run again), never with a null id', () => {
    const forCurrent = new Map([['current', { notesExcluded: 'bad merge' }]]);
    expect(deriveEmbedded(report(['a']), window, { ...OPTIONS, notes: forCurrent, notesFile: 'read' })?.current).toEqual({ ...OPTIONS.current, notesExcluded: 'bad merge' });
    const unrecorded = { ...OPTIONS.current, id: null };
    expect(deriveEmbedded(report(['a']), window, { ...OPTIONS, current: unrecorded, notes: forCurrent, notesFile: 'read' })?.current).toEqual(unrecorded);
  });

  it('embeds the status of the file: invalid and off', () => {
    expect(deriveEmbedded(report(['a']), window, { ...OPTIONS, notesFile: 'invalid' })?.notesFile).toBe('invalid');
    expect(deriveEmbedded(report(['a']), window, { ...OPTIONS, notesFile: 'off' })?.notesFile).toBe('off');
  });

  it('embeds where the notes file is, as given, and null when it is off', () => {
    expect(deriveEmbedded(report(['a']), window, { ...OPTIONS, notesPath: 'config/team-notes.json' })?.notesPath).toBe('config/team-notes.json');
    expect(deriveEmbedded(report(['a']), window, { ...OPTIONS, notesFile: 'off', notesPath: null })?.notesPath).toBeNull();
  });
});

describe('deriveEmbedded', () => {
  it('is null without a past run', () => {
    expect(deriveEmbedded(report(['a']), { runs: [], others: [], skipped: 0 }, OPTIONS)).toBeNull();
  });

  it('every file of the window skipped (a newer Loupe, corrupt): a block with no run, never null, so the report can say why', () => {
    const value = deriveEmbedded(report(['a']), { runs: [], others: [], skipped: 2 }, OPTIONS);
    expect(value).toMatchObject({ runs: [], cells: '', skipped: 2 });
  });

  it("gives the current run's origin and masked exclusion reason as the caller computed them", () => {
    const current = { origin: 'ide' as const, excluded: 'database restored', id: 'current' };
    const value = deriveEmbedded(report(['a']), { runs: [run('r1', 1, [row('a', 'P')])], others: [], skipped: 1 }, { ...OPTIONS, current });
    expect([value?.current, value?.skipped]).toEqual([current, 1]);
  });

  it("leaves out the current run's own earlier file (a merge run again): alone, no history", () => {
    expect(deriveEmbedded(report(['a']), { runs: [run('current', 2, [row('a', 'P')])], others: [], skipped: 0 }, OPTIONS)).toBeNull();
    const value = deriveEmbedded(report(['a']), { runs: [run('current', 3, [row('a', 'F')]), run('past', 2, [row('a', 'P')])], others: [], skipped: 0 }, OPTIONS);
    expect(value?.runs.map((entry) => entry.id)).toEqual(['past']);
  });

  it('aligns one character per test of the report and run, oldest run first, - for no result', () => {
    // Newest first, as read.
    const runs = [run('r2', 2, [row('a', 'P'), row('b', 'S', { r: 1 })]), run('r1', 1, [row('a', 'K', { a: 'FP' }), row('c', 'P')])];
    const value = deriveEmbedded(report(['a'], ['b', 1], ['c'], ['new']), { runs, others: [], skipped: 0 }, OPTIONS);
    expect(value?.runs.map((entry) => entry.id)).toEqual(['r1', 'r2']);
    // a: K then P; b (repeat 1): - then S; c: P then -; new: - -.
    expect(value?.cells).toBe('KP-SP---');
  });

  it("gives every failing cell its signature and attempts in run order, and the other cells' attempts only when not implied", () => {
    const runs = [run('r2', 2, [failed('a', 's2', 'TF'), row('b', 'P', { a: 'F' })]), run('r1', 1, [failed('a', 's1', 'FP', 'K'), row('b', 'P')])];
    const value = deriveEmbedded(report(['a'], ['b']), { runs, others: [], skipped: 0 }, OPTIONS);
    // Most recently seen first: s2 then s1.
    expect(value?.signatures).toEqual([
      ['s2', 'Assertion', 'extract of s2'],
      ['s1', 'Assertion', 'extract of s1'],
    ]);
    expect(value?.failures).toEqual([[0, 1, 0]]);
    expect(value?.failureAttempts).toBe('FP TF');
    // b passed as expected after an expected failure (test.fail()): its attempts are not implied.
    expect(value?.attempts).toEqual([[1, 1, 'F']]);
  });

  it('a failing cell without an error gets -1', () => {
    const value = deriveEmbedded(report(['a']), { runs: [run('r1', 1, [row('a', 'F', { a: 'P' })])], others: [], skipped: 0 }, OPTIONS);
    expect([value?.failures, value?.signatures]).toEqual([[[0, -1]], []]);
  });

  it(`keeps the extracts of the ${EMBEDDED_EXTRACTS} most recently seen signatures only`, () => {
    const count = EMBEDDED_EXTRACTS + 5;
    const tests = Array.from({ length: count }, (_, index) => `t${index}`);
    // One run per day; the newest run holds the first signatures.
    const runs = tests.map((id, index) => run(`r${index}`, 1, [failed(id, `sig${index}`)], { run: { ...makeRunFile().run, id: `r${index}`, startedAt: new Date(Date.UTC(2026, 9, 30) - index * 1000).toISOString(), stream: STREAM } }));
    const value = deriveEmbedded(report(...tests.map((id) => [id] as [string])), { runs, others: [], skipped: 0 }, OPTIONS);
    expect(value?.signatures).toHaveLength(count);
    expect(value?.signatures.filter(([, , extract]) => extract !== null)).toHaveLength(EMBEDDED_EXTRACTS);
    expect(value?.signatures[0]).toEqual(['sig0', 'Assertion', 'extract of sig0']);
    expect(value?.signatures[count - 1]).toEqual([`sig${count - 1}`, 'Assertion', null]);
  });

  describe('a cut extract says so: the fourth element, only from xc and only with its text', () => {
    const LONG = 'x'.repeat(300);
    const cutFailure = (id: string, sig: string, xc: boolean): HistoryTest => row(id, 'F', { a: 'FF', f: [{ i: 0, sig: [sig], cat: 'Assertion', x: LONG, ...(xc ? { xc: true as const } : {}), at: null }] });

    it('flagged xc: [signature, category, extract, true]; an uncut extract: three elements', () => {
      const value = deriveEmbedded(report(['a'], ['b']), { runs: [run('r1', 1, [cutFailure('a', 'cut', true), failed('b', 'whole')])], others: [], skipped: 0 }, OPTIONS);
      expect(value?.signatures).toEqual([
        ['cut', 'Assertion', LONG, true],
        ['whole', 'Assertion', 'extract of whole'],
      ]);
    });

    it('a run file without xc (written before the flag): no flag, even for an extract of 300 characters', () => {
      const value = deriveEmbedded(report(['a']), { runs: [run('r1', 1, [cutFailure('a', 'old', false)])], others: [], skipped: 0 }, OPTIONS);
      expect(value?.signatures).toEqual([['old', 'Assertion', LONG]]);
    });

    it(`beyond the ${EMBEDDED_EXTRACTS} extracts kept: no text, so no flag`, () => {
      const count = EMBEDDED_EXTRACTS + 1;
      const tests = Array.from({ length: count }, (_, index) => `t${index}`);
      const runs = tests.map((id, index) => run(`r${index}`, 1, [cutFailure(id, `sig${index}`, true)], { run: { ...makeRunFile().run, id: `r${index}`, startedAt: new Date(Date.UTC(2026, 9, 30) - index * 1000).toISOString(), stream: STREAM } }));
      const value = deriveEmbedded(report(...tests.map((id) => [id] as [string])), { runs, others: [], skipped: 0 }, OPTIONS);
      expect(value?.signatures[0]).toEqual(['sig0', 'Assertion', LONG, true]);
      expect(value?.signatures[count - 1]).toEqual([`sig${count - 1}`, 'Assertion', null]);
    });

    it('the newest failure of a signature gives its extract and its flag', () => {
      const runs = [run('new', 2, [failed('a', 'same')]), run('old', 1, [cutFailure('a', 'same', true)])];
      const value = deriveEmbedded(report(['a']), { runs, others: [], skipped: 0 }, OPTIONS);
      expect(value?.signatures).toEqual([['same', 'Assertion', 'extract of same']]);
    });
  });

  it('a run of another signature version: statuses kept, signatures not compared', () => {
    const runs = [run('new', 2, [failed('a', 'same')]), run('old', 1, [failed('a', 'old-sig')], { signatureVersion: 5 })];
    const value = deriveEmbedded(report(['a']), { runs, others: [], skipped: 0 }, OPTIONS);
    expect(value?.runs.map((entry) => entry.sameSignatures)).toEqual([false, true]);
    expect(value?.cells).toBe('FF');
    expect(value?.signatures.map(([sig]) => sig)).toEqual(['same']);
    expect(value?.failures).toEqual([[0, -1, 0]]);
  });

  it('describes each run with what the statistics need: scope and its reasons, exclusion, origin, retries per project', () => {
    const file = run('r1', 1, [row('a', 'P')]);
    file.run = {
      ...file.run,
      scope: 'partial',
      scopeReasons: ['grep', 'project'],
      excluded: { reason: 'flaky infra' },
      origin: 'ide',
      git: { commit: 'abc', branch: 'main' },
      projects: [
        { name: 'chromium', retries: 2 },
        { name: 'api', retries: 0 },
      ],
    };
    const value = deriveEmbedded(report(['a']), { runs: [file], others: [], skipped: 0 }, { ...OPTIONS, include: 'all' });
    expect(value?.include).toBe('all');
    expect(value?.stream).toEqual(STREAM);
    expect(value?.runs[0]).toEqual({
      id: 'r1',
      reportRunId: file.run.reportRunId,
      startedAt: '2026-11-01T10:00:00.000Z',
      durationMs: 1,
      status: 'passed',
      origin: 'ide',
      scope: 'partial',
      scopeReasons: ['grep', 'project'],
      excluded: 'flaky infra',
      commit: 'abc',
      branch: 'main',
      stats: file.run.stats,
      projects: [
        ['chromium', 2],
        ['api', 0],
      ],
      sameSignatures: true,
    });
  });

  it('gives the newest run of each other stream as one character per test of the report', () => {
    const other = { ...run('o1', 3, [row('b', 'F'), row('a', 'P')]), run: { ...makeRunFile().run, id: 'o1', startedAt: '2026-11-03T10:00:00.000Z', stream: { environment: 'prod', origin: 'ci' } } };
    const value = deriveEmbedded(report(['a'], ['b'], ['c']), { runs: [], others: [other], skipped: 0 }, OPTIONS);
    expect(value?.runs).toEqual([]);
    expect(value?.cells).toBe('');
    expect(value?.others).toEqual([{ stream: { environment: 'prod', origin: 'ci' }, id: 'o1', startedAt: '2026-11-03T10:00:00.000Z', cells: 'PF-' }]);
  });
});
