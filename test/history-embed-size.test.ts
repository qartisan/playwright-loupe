import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { deriveEmbedded } from '../src/core/history/embed.js';
import { DEFAULT_RENDERER_SETTINGS, injectData, injectHistory, injectSettings, serializeForScript } from '../src/core/inject.js';
import type { EmbeddedHistory, HistoryRunFile, RunNotes } from '../src/schema/history-v1.js';
import type { LoupeReport } from '../src/schema/v1.js';
import { ROOT, assertBuilt } from './helpers/fixtures.js';
import { NO_NOTES } from './helpers/history.js';
import { perfSampleReport, random, realisticReport, simulateWindow } from './helpers/history-sim.js';

/** Brief 24, decision 8: the embedded history of a realistic 5,000-test run stays under 40 kB gzip. */
const REALISTIC_LIMIT = 40_000;
/** The perf:sample dataset, 56% failing: a looser regression bound. */
const PERF_SAMPLE_LIMIT = 90_000;

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

function embedded(report: LoupeReport, otherStreams: number, notes: 'none' | 'realistic' = 'realistic'): EmbeddedHistory {
  const runs = simulateWindow(report, 20, STREAM);
  const others = Array.from({ length: otherStreams }, (_, index) => simulateWindow(report, 1, { environment: `other-${index}`, origin: 'ci' }, random(100 + index))[0]!);
  const withNotes = notes === 'realistic' ? { notes: realisticNotes(runs), notesFile: 'read' as const, notesPath: 'loupe.notes.json' } : NO_NOTES;
  const value = deriveEmbedded(report, { runs, others, skipped: 0 }, { include: 'full', stream: STREAM, current: { origin: 'local', excluded: null, id: CURRENT_ID }, currentRunId: 'current', ...withNotes });
  if (value === null) throw new Error('no embedded history');
  return value;
}

/** Gzip bytes of the block alone, and what it adds to the whole index.html. */
function measure(template: string, report: LoupeReport, value: EmbeddedHistory): { alone: number; added: number } {
  const page = injectSettings(injectData(template, report), DEFAULT_RENDERER_SETTINGS);
  const gzip = (text: string) => gzipSync(text).byteLength;
  return { alone: gzip(serializeForScript(value)), added: gzip(injectHistory(page, value)) - gzip(injectHistory(page, null)) };
}

describe('size of the embedded history at 5,000 tests (N = 20)', () => {
  let template: string;
  beforeAll(() => {
    assertBuilt();
    template = readFileSync(path.join(ROOT, 'dist/renderer/index.html'), 'utf8');
  });

  it(`a realistic run (2% failing, two other streams, realistic notes): under ${REALISTIC_LIMIT / 1000} kB gzip`, () => {
    const report = realisticReport();
    const value = embedded(report, 2);
    expect(value.runs.filter((run) => run.notesExcluded !== undefined)).toHaveLength(5);
    const size = measure(template, report, value);
    if (process.env['LOUPE_MEASURE']) console.log('realistic', size, 'without notes', measure(template, report, embedded(report, 2, 'none')));
    expect(size.alone).toBeLessThan(REALISTIC_LIMIT);
  });

  it(`the perf:sample dataset (56% failing, two other streams, realistic notes): under ${PERF_SAMPLE_LIMIT / 1000} kB gzip`, () => {
    const report = perfSampleReport();
    const value = embedded(report, 2);
    const size = measure(template, report, value);
    if (process.env['LOUPE_MEASURE']) {
      console.log('perf:sample', size, 'without notes', measure(template, report, embedded(report, 2, 'none')), { signatures: value.signatures.length, withExtract: value.signatures.filter(([, , x]) => x !== null).length });
    }
    expect(size.alone).toBeLessThan(PERF_SAMPLE_LIMIT);
  });
});
