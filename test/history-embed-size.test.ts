import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { type EmbedOptions, deriveEmbedded, deriveWithinBudget, embeddedBudget, embeddedSize } from '../src/core/history/embed.js';
import { DEFAULT_RENDERER_SETTINGS, injectData, injectHistory, injectSettings, serializeForScript } from '../src/core/inject.js';
import type { EmbeddedHistory, HistoryRunFile, HistoryTest, RunNotes } from '../src/schema/history-v1.js';
import type { LoupeReport } from '../src/schema/v1.js';
import { ROOT, assertBuilt } from './helpers/fixtures.js';
import { NO_NOTES, makeRunFile } from './helpers/history.js';
import { type SimulatedWindow, WINDOWS, perfSampleReport, random, realisticReport } from './helpers/history-sim.js';

/** Brief 24, decision 8: the embedded history of a realistic 5,000-test run stays under 40 kB gzip. */
const REALISTIC_LIMIT = 40_000;

const STREAM = { environment: 'default', origin: 'local' };
/** A local run id, the longest common form: a UUID. */
const CURRENT_ID = '6f1c2b9e-8d3a-4c5b-9e7f-1a2b3c4d5e6f';

/** Notes people write about runs: short, each its own. */
const NOTES = [
  'First run after the auth refactor',
  'Staging DB restored from Monday backup',
  'New checkout flow behind the flag',
  'Ran on the new runner image (Ubuntu 24.04)',
  'Payments sandbox slow all afternoon',
  'Flaky search tests quarantined in PR 1482',
  'Upgraded Playwright to 1.64',
  'Login page redesign merged',
  'CDN cache purged before the run',
  'Feature flags reset to defaults',
  'Retry count raised to 2 for this sprint',
  'Shared test account locked, reset by ops',
  'Mobile projects added',
  'Third-party maps API returned 429s',
  'Release candidate 4.2.0',
  'Database migration 0193 applied',
  'VPN dropped mid-run on the office network',
  'Seed data regenerated',
  'Timeouts tuned for the slower staging box',
  'Hotfix for the cart total rounding',
];
const REASONS = ['Staging was down (VPN)', 'Seed data missing after the restore', 'Wrong environment URL in the CI variables', 'Runner out of disk space'];

/**
 * The realistic notes case (brief 26, Step 0): a note on every run of the window, a quarter of them excluded
 * from the file, as a team that annotates its runs would have it.
 */
function realisticNotes(runs: readonly HistoryRunFile[]): Map<string, RunNotes> {
  return new Map(runs.map((file, index) => [file.run.id, { note: NOTES[index % NOTES.length] as string, ...(index % 4 === 0 ? { notesExcluded: REASONS[index / 4 % REASONS.length] as string } : {}) }]));
}

/** What the block is derived from: a window of 20 runs and `otherStreams` other streams, with or without notes. */
function inputs(report: LoupeReport, window: SimulatedWindow, otherStreams: number, notes: 'none' | 'realistic' = 'realistic') {
  const runs = window(report, 20, STREAM);
  const others = Array.from({ length: otherStreams }, (_, index) => window(report, 1, { environment: `other-${index}`, origin: 'ci' }, random(100 + index))[0]!);
  const withNotes = notes === 'realistic' ? { notes: realisticNotes(runs), notesFile: 'read' as const, notesPath: 'loupe.notes.json' } : NO_NOTES;
  const options: EmbedOptions = { include: 'full', stream: STREAM, current: { origin: 'local', excluded: null, id: CURRENT_ID }, currentRunId: 'current', ...withNotes };
  return [report, { runs, others, skipped: 0 }, options] as const;
}

/** The whole block, without the budget. */
function embedded(report: LoupeReport, window: SimulatedWindow, otherStreams: number, notes: 'none' | 'realistic' = 'realistic'): EmbeddedHistory {
  const value = deriveEmbedded(...inputs(report, window, otherStreams, notes));
  if (value === null) throw new Error('no embedded history');
  return value;
}

/** Gzip bytes of the block alone, and what it adds to the whole index.html. */
function measure(template: string, report: LoupeReport, value: EmbeddedHistory): { alone: number; added: number } {
  const page = injectSettings(injectData(template, report), DEFAULT_RENDERER_SETTINGS);
  const gzip = (text: string) => gzipSync(text).byteLength;
  return { alone: gzip(serializeForScript(value)), added: gzip(injectHistory(page, value)) - gzip(injectHistory(page, null)) };
}

/** Milliseconds `run` takes, the median of three. */
function time(run: () => unknown): number {
  const times = [0, 1, 2].map(() => {
    const start = performance.now();
    run();
    return performance.now() - start;
  });
  return Math.round(times.sort((a, b) => a - b)[1] as number);
}

/** The run's cells of one test in a block: `[code, category, extract]` per run, by run id. */
function cellsById(block: EmbeddedHistory): Map<string, Array<[string, string | null, string | null]>> {
  const width = block.runs.length;
  const rows = new Map(block.failures.map(([test, ...sigs]) => [test as number, sigs]));
  const byRun = new Map(block.runs.map((run) => [run.id, [] as Array<[string, string | null, string | null]>]));
  const tests = width === 0 ? 0 : block.cells.length / width;
  for (let test = 0; test < tests; test++) {
    let ordinal = 0;
    block.runs.forEach((run, column) => {
      const code = block.cells[test * width + column] as string;
      const sig = code === 'F' || code === 'K' ? (rows.get(test)?.[ordinal++] ?? -1) : -1;
      const entry = sig >= 0 ? block.signatures[sig] : undefined;
      byRun.get(run.id)?.push([code, entry?.[0] ?? null, entry?.[1] ?? null]);
    });
  }
  return byRun;
}

/**
 * The budgeted block is the whole one less exactly what its `trimmed` record says, in the order of the budget:
 * a part is cut only once every earlier one is gone. Nothing left out comes back elsewhere in the block.
 */
function expectTrimmedMatches(whole: EmbeddedHistory, value: EmbeddedHistory): void {
  const trimmed = value.trimmed ?? {};
  const { trimmed: _, ...rest } = value;
  const left = { runs: trimmed.runs ?? 0, streams: trimmed.streams ?? 0 };
  // Runs and other streams: the newest kept, whole.
  expect(value.runs).toEqual(whole.runs.slice(left.runs));
  expect(value.others).toEqual(whole.others.slice(0, whole.others.length - left.streams));
  expect([rest.v, rest.include, rest.current, rest.skipped, rest.notesFile, rest.notesPath]).toEqual([whole.v, whole.include, whole.current, whole.skipped, whole.notesFile, whole.notesPath]);
  // Cells: statuses unchanged; signatures only for runs started from signaturesBefore; extracts only the first ones.
  const wholeCells = cellsById(whole);
  const before = trimmed.signaturesBefore;
  for (const [id, cells] of cellsById(value)) {
    const run = value.runs.find((entry) => entry.id === id);
    const reference = wholeCells.get(id) ?? [];
    const cut = before !== undefined && run !== undefined && run.startedAt < before;
    cells.forEach(([code, category], test) => {
      expect(code).toBe(reference[test]?.[0]);
      expect(category).toBe(cut ? null : reference[test]?.[1]);
    });
  }
  // The dictionary holds only what a kept cell points to.
  const used = new Set(value.failures.flatMap(([, ...sigs]) => sigs.filter((sig) => sig >= 0)));
  expect(used.size).toBe(value.signatures.length);
  const texts = value.signatures.filter(([, extract]) => extract !== null).length;
  if (trimmed.extracts !== undefined) {
    expect(texts).toBe(trimmed.extracts);
    expect(value.signatures.slice(trimmed.extracts).every(([, extract]) => extract === null)).toBe(true);
  } else {
    expect(texts).toBe(Math.min(whole.signatures.filter(([, extract]) => extract !== null).length, value.signatures.slice(0, 300).filter(([, extract]) => extract !== null).length));
  }
  // The order: a part is cut only once the earlier ones are gone.
  if (before !== undefined) expect(texts).toBe(0);
  if (left.streams > 0) expect(value.signatures).toEqual([]);
  if (left.runs > 0) expect(value.others).toEqual([]);
}

describe('size of the embedded history at 5,000 tests (N = 20)', () => {
  let template: string;
  beforeAll(() => {
    assertBuilt();
    template = readFileSync(path.join(ROOT, 'dist/renderer/index.html'), 'utf8');
  });

  it.each([
    ['an ordinary window', 'normal'],
    ['a window of incident days', 'incidentDays'],
  ] as const)(`a realistic run, calibrated, %s (two other streams, realistic notes): under ${REALISTIC_LIMIT / 1000} kB gzip, whole`, (_, name) => {
    const report = realisticReport();
    const value = embedded(report, WINDOWS[name], 2);
    expect(value.runs.filter((run) => run.notesExcluded !== undefined)).toHaveLength(5);
    expect(new Set(value.runs.map((run) => run.note)).size).toBe(20);
    const size = measure(template, report, value);
    if (process.env['LOUPE_MEASURE']) {
      console.log(`realistic, ${name}`, size, 'without notes', measure(template, report, embedded(report, WINDOWS[name], 2, 'none')), { signatures: value.signatures.length });
    }
    expect(size.alone).toBeLessThan(REALISTIC_LIMIT);
    // Under the budget, the block is the whole one, byte for byte, with no trimmed record.
    const budgeted = deriveWithinBudget(...inputs(report, WINDOWS[name], 2));
    expect(budgeted.problems).toEqual([]);
    expect(serializeForScript(budgeted.value)).toBe(serializeForScript(value));
  });
});

describe('the byte budget of the embedded history: the larger of 40 kB and 8 B per test, gzip', () => {
  it('is 40,000 B up to 5,000 tests, then 8 B per test', () => {
    expect([1, 168, 5000, 5001, 20_000, 50_000].map(embeddedBudget)).toEqual([40_000, 40_000, 40_000, 40_008, 160_000, 400_000]);
  });

  // Brief 23's model gives almost every failure its own signature: the worst case for the dictionary.
  it.each([
    // Signatures kept for the newest run only.
    ['perf:sample, 5,000 tests', () => perfSampleReport(), { extracts: 0, signaturesBefore: '2026-11-01T00:00:00.000Z' }],
    ['perf:sample, 20,000 tests', () => perfSampleReport(20_000), { extracts: 0, signaturesBefore: '2026-10-30T00:00:00.000Z' }],
    ['perf:sample, 50,000 tests', () => perfSampleReport(50_000), { extracts: 0, signaturesBefore: '2026-10-30T00:00:00.000Z' }],
    ['realistic, 5,000 tests', () => realisticReport(), {}],
    ['realistic, 20,000 tests', () => realisticReport(20_000), {}],
    ['realistic, 50,000 tests', () => realisticReport(50_000), {}],
  ] as const)("brief 23's model, %s: under the budget, the trimmed record matching what was left out", { timeout: 120_000 }, (name, make, expected) => {
    const report = make();
    const args = inputs(report, WINDOWS.brief23, 2);
    const whole = deriveEmbedded(...args);
    const { value, problems } = deriveWithinBudget(...args);
    if (whole === null || value === null) throw new Error('no embedded history');
    const budget = embeddedBudget(report.tests.length);
    expect(problems).toEqual([]);
    expect(embeddedSize(value)).toBeLessThanOrEqual(budget);
    expect(value.trimmed ?? {}).toEqual(expected);
    expectTrimmedMatches(whole, value);
    if (process.env['LOUPE_MEASURE']) {
      const under = WINDOWS.normal;
      const normalArgs = inputs(report, under, 2);
      console.log(`budget, ${name}`, {
        budget,
        whole: embeddedSize(whole),
        kept: embeddedSize(value),
        trimmed: value.trimmed,
        deriveMs: time(() => deriveEmbedded(...args)),
        withinBudgetMs: time(() => deriveWithinBudget(...args)),
        normalDeriveMs: time(() => deriveEmbedded(...normalArgs)),
        normalWithinBudgetMs: time(() => deriveWithinBudget(...normalArgs)),
        normal: deriveWithinBudget(...normalArgs).value?.trimmed ?? 'whole',
      });
    }
  });

  /**
   * A window built to go through every step: each of its 50 tests fails in every run with an error of its own and a
   * long extract, each run lists 400 projects, and 100 other streams have long names. Not a realistic input: the
   * runs' metadata alone is over the budget.
   */
  function heavy(runs: number, projects: number, streams: number) {
    const rnd = random(5);
    const hex = (length: number) => Array.from({ length }, () => '0123456789abcdef'[Math.floor(rnd() * 16)]).join('');
    const report = perfSampleReport(50);
    const day = 24 * 60 * 60 * 1000;
    const window = Array.from({ length: runs }, (_, k) =>
      makeRunFile(
        { id: `run-${k}`, startedAt: new Date(Date.UTC(2026, 10, 1) - k * day).toISOString(), projects: Array.from({ length: projects }, () => ({ name: hex(12), retries: 0 })) },
        report.tests.map((test): HistoryTest => ({ id: test.id, ...(test.repeatEachIndex !== 0 ? { r: test.repeatEachIndex } : {}), t: [test.title], o: 'F', d: 1, a: 'FF', f: [{ i: 0, sig: [hex(12)], cat: null, x: hex(300), at: null }] })),
      ),
    );
    const others = Array.from({ length: streams }, (_, index) => makeRunFile({ id: `other-${index}`, stream: { environment: hex(40), origin: 'ci' } }, []));
    const options: EmbedOptions = { include: 'full', stream: STREAM, current: { origin: 'local', excluded: null, id: CURRENT_ID }, currentRunId: 'current', ...NO_NOTES };
    return [report, { runs: window, others, skipped: 0 }, options] as const;
  }

  it('leaves out every part in turn, down to the oldest runs, as its trimmed record says', () => {
    const args = heavy(20, 400, 100);
    const whole = deriveEmbedded(...args);
    const { value, problems } = deriveWithinBudget(...args);
    if (whole === null || value === null) throw new Error('no embedded history');
    expect(problems).toEqual([]);
    expect(embeddedSize(value)).toBeLessThanOrEqual(40_000);
    // Every signature left out: the date is the current run's start, as no run of the window keeps any, and the
    // dictionary is empty, so no entry is missing its extract.
    expect(value.trimmed).toEqual({ signaturesBefore: args[0].run.startedAt, streams: 100, runs: 8 });
    expect(value.signatures).toEqual([]);
    expect(value.runs.length).toBeGreaterThan(1);
    expectTrimmedMatches(whole, value);
  });

  /**
   * A window cut within its signatures: 100 tests failing in each of 20 runs, every error its own with a long
   * category, so each run's signatures weigh about the same. `tie` gives one run the start of the run after it.
   */
  function signatureHeavy(tie?: { run: number }) {
    const rnd = random(9);
    const hex = (length: number) => Array.from({ length }, () => '0123456789abcdef'[Math.floor(rnd() * 16)]).join('');
    const report = perfSampleReport(100);
    const day = 24 * 60 * 60 * 1000;
    // Oldest first, as the window reads; the run files are read newest first.
    const starts = Array.from({ length: 20 }, (_, column) => new Date(Date.UTC(2026, 10, 1) - (19 - column) * day).toISOString());
    if (tie) starts[tie.run] = starts[tie.run + 1] as string;
    const runs = starts
      .map((startedAt, column) =>
        makeRunFile(
          { id: `run-${column}`, startedAt },
          report.tests.map((test): HistoryTest => ({ id: test.id, ...(test.repeatEachIndex !== 0 ? { r: test.repeatEachIndex } : {}), t: [test.title], o: 'F', d: 1, a: 'FF', f: [{ i: 0, sig: [hex(12)], cat: hex(40), x: hex(100), at: null }] })),
        ),
      )
      .reverse();
    const options: EmbedOptions = { include: 'full', stream: STREAM, current: { origin: 'local', excluded: null, id: CURRENT_ID }, currentRunId: 'current', ...NO_NOTES };
    return [report, { runs, others: [] as HistoryRunFile[], skipped: 0 }, options] as const;
  }

  it('cuts runs with the same start together, so signaturesBefore tells exactly which runs lost their signatures', () => {
    // Without a tie: the cut falls between run `cut - 1`, the last without signatures, and run `cut`.
    const untied = deriveWithinBudget(...signatureHeavy()).value;
    const cut = untied?.runs.findIndex((run) => run.startedAt === untied.trimmed?.signaturesBefore) ?? -1;
    expect(cut).toBeGreaterThan(1);
    expect(untied?.trimmed?.runs).toBeUndefined();

    // The same window, its runs `cut - 1` and `cut` started at the same time: the smallest cut would split them.
    const args = signatureHeavy({ run: cut - 1 });
    const whole = deriveEmbedded(...args);
    const value = deriveWithinBudget(...args).value;
    if (whole === null || value === null) throw new Error('no embedded history');
    const pair = [value.runs[cut - 1], value.runs[cut]];
    expect(pair[0]?.startedAt).toBe(pair[1]?.startedAt);
    // Both lose their signatures: the date is the start of the run after them, and both started before it.
    expect(value.trimmed?.signaturesBefore).toBe(value.runs[cut + 1]?.startedAt);
    const signaturesOf = (column: number) => value.failures.map(([, ...sigs]) => sigs[column]);
    for (const column of [cut - 1, cut]) expect(new Set(signaturesOf(column))).toEqual(new Set([-1]));
    expect(signaturesOf(cut + 1).every((sig) => sig !== undefined && sig >= 0)).toBe(true);
    expectTrimmedMatches(whole, value);
  });

  it('last resort: over the budget with only the newest run, no block and one problem, never an error', () => {
    const { value, problems } = deriveWithinBudget(...heavy(3, 12_000, 0));
    expect(value).toBeNull();
    expect(problems).toEqual([expect.stringMatching(/^the history was too large to embed \(\d+\.\d kB gzip with only the newest run, over its budget of 40\.0 kB\)$/)]);
  });
});
