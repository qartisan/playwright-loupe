import { describe, expect, it } from 'vitest';
import { deriveEmbedded } from '../src/core/history/embed.js';
import { EMBEDDED_EXTRACTS, type HistoryRunFile, type HistoryTest } from '../src/schema/history-v1.js';
import type { LoupeReport } from '../src/schema/v1.js';
import { makeRunFile } from './helpers/history.js';

const STREAM = { environment: 'staging', origin: 'ci' };
const OPTIONS = { include: 'full' as const, stream: STREAM, currentRunId: 'current' };

/** Only what the derivation reads from the report: its tests, in order. */
const report = (...tests: Array<[id: string, repeatEachIndex?: number]>) =>
  ({ tests: tests.map(([id, repeatEachIndex = 0]) => ({ id, repeatEachIndex })) }) as unknown as LoupeReport;

const row = (id: string, o: HistoryTest['o'], extra: Partial<HistoryTest> = {}): HistoryTest => ({ id, t: ['p', 'a.spec.ts', id], o, d: 1, ...extra });
const failed = (id: string, sig: string, a = 'FF', o: HistoryTest['o'] = 'F'): HistoryTest => row(id, o, { a, f: [{ i: 0, sig: [sig], cat: 'Assertion', x: `extract of ${sig}`, at: null }] });
const run = (id: string, day: number, tests: HistoryTest[], extra: Partial<HistoryRunFile> = {}): HistoryRunFile => ({
  ...makeRunFile({ id, startedAt: `2026-11-${String(day).padStart(2, '0')}T10:00:00.000Z`, stream: STREAM }, tests),
  ...extra,
});

describe('deriveEmbedded', () => {
  it('is null without a past run', () => {
    expect(deriveEmbedded(report(['a']), { runs: [], others: [] }, OPTIONS)).toBeNull();
  });

  it("leaves out the current run's own earlier file (a merge run again): alone, no history", () => {
    expect(deriveEmbedded(report(['a']), { runs: [run('current', 2, [row('a', 'P')])], others: [] }, OPTIONS)).toBeNull();
    const value = deriveEmbedded(report(['a']), { runs: [run('current', 3, [row('a', 'F')]), run('past', 2, [row('a', 'P')])], others: [] }, OPTIONS);
    expect(value?.runs.map((entry) => entry.id)).toEqual(['past']);
  });

  it('aligns one character per test of the report and run, oldest run first, - for no result', () => {
    // Newest first, as read.
    const runs = [run('r2', 2, [row('a', 'P'), row('b', 'S', { r: 1 })]), run('r1', 1, [row('a', 'K', { a: 'FP' }), row('c', 'P')])];
    const value = deriveEmbedded(report(['a'], ['b', 1], ['c'], ['new']), { runs, others: [] }, OPTIONS);
    expect(value?.runs.map((entry) => entry.id)).toEqual(['r1', 'r2']);
    // a: K then P; b (repeat 1): - then S; c: P then -; new: - -.
    expect(value?.cells).toBe('KP-SP---');
  });

  it("gives every failing cell its signature and attempts in run order, and the other cells' attempts only when not implied", () => {
    const runs = [run('r2', 2, [failed('a', 's2', 'TF'), row('b', 'P', { a: 'F' })]), run('r1', 1, [failed('a', 's1', 'FP', 'K'), row('b', 'P')])];
    const value = deriveEmbedded(report(['a'], ['b']), { runs, others: [] }, OPTIONS);
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
    const value = deriveEmbedded(report(['a']), { runs: [run('r1', 1, [row('a', 'F', { a: 'P' })])], others: [] }, OPTIONS);
    expect([value?.failures, value?.signatures]).toEqual([[[0, -1]], []]);
  });

  it(`keeps the extracts of the ${EMBEDDED_EXTRACTS} most recently seen signatures only`, () => {
    const count = EMBEDDED_EXTRACTS + 5;
    const tests = Array.from({ length: count }, (_, index) => `t${index}`);
    // One run per day; the newest run holds the first signatures.
    const runs = tests.map((id, index) => run(`r${index}`, 1, [failed(id, `sig${index}`)], { run: { ...makeRunFile().run, id: `r${index}`, startedAt: new Date(Date.UTC(2026, 9, 30) - index * 1000).toISOString(), stream: STREAM } }));
    const value = deriveEmbedded(report(...tests.map((id) => [id] as [string])), { runs, others: [] }, OPTIONS);
    expect(value?.signatures).toHaveLength(count);
    expect(value?.signatures.filter(([, , extract]) => extract !== null)).toHaveLength(EMBEDDED_EXTRACTS);
    expect(value?.signatures[0]).toEqual(['sig0', 'Assertion', 'extract of sig0']);
    expect(value?.signatures[count - 1]).toEqual([`sig${count - 1}`, 'Assertion', null]);
  });

  it('a run of another signature version: statuses kept, signatures not compared', () => {
    const runs = [run('new', 2, [failed('a', 'same')]), run('old', 1, [failed('a', 'old-sig')], { signatureVersion: 5 })];
    const value = deriveEmbedded(report(['a']), { runs, others: [] }, OPTIONS);
    expect(value?.runs.map((entry) => entry.comparable)).toEqual([false, true]);
    expect(value?.cells).toBe('FF');
    expect(value?.signatures.map(([sig]) => sig)).toEqual(['same']);
    expect(value?.failures).toEqual([[0, -1, 0]]);
  });

  it('describes each run with what the statistics need: scope, exclusion, origin', () => {
    const file = run('r1', 1, [row('a', 'P')]);
    file.run = { ...file.run, scope: 'partial', scopeReasons: ['grep'], excluded: { reason: 'flaky infra' }, origin: 'ide', git: { commit: 'abc', branch: 'main' } };
    const value = deriveEmbedded(report(['a']), { runs: [file], others: [] }, { ...OPTIONS, include: 'all' });
    expect(value?.include).toBe('all');
    expect(value?.stream).toEqual(STREAM);
    expect(value?.runs[0]).toMatchObject({ id: 'r1', scope: 'partial', excluded: 'flaky infra', origin: 'ide', commit: 'abc', branch: 'main', comparable: true });
  });

  it('gives the newest run of each other stream as one character per test of the report', () => {
    const other = { ...run('o1', 3, [row('b', 'F'), row('a', 'P')]), run: { ...makeRunFile().run, id: 'o1', startedAt: '2026-11-03T10:00:00.000Z', stream: { environment: 'prod', origin: 'ci' } } };
    const value = deriveEmbedded(report(['a'], ['b'], ['c']), { runs: [], others: [other] }, OPTIONS);
    expect(value?.runs).toEqual([]);
    expect(value?.cells).toBe('');
    expect(value?.others).toEqual([{ stream: { environment: 'prod', origin: 'ci' }, id: 'o1', startedAt: '2026-11-03T10:00:00.000Z', cells: 'PF-' }]);
  });
});
