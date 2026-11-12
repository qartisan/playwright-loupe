import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { deriveEmbedded } from '../src/core/history/embed.js';
import { DEFAULT_RENDERER_SETTINGS, injectData, injectHistory, injectSettings, serializeForScript } from '../src/core/inject.js';
import type { EmbeddedHistory } from '../src/schema/history-v1.js';
import type { LoupeReport } from '../src/schema/v1.js';
import { ROOT, assertBuilt } from './helpers/fixtures.js';
import { perfSampleReport, random, realisticReport, simulateWindow } from './helpers/history-sim.js';

/** Brief 24, decision 8: the embedded history of a realistic 5,000-test run stays under 40 kB gzip. */
const REALISTIC_LIMIT = 40_000;
/** The perf:sample dataset, 56% failing: a looser regression bound. */
const PERF_SAMPLE_LIMIT = 90_000;

const STREAM = { environment: 'default', origin: 'local' };

function embedded(report: LoupeReport, otherStreams: number): EmbeddedHistory {
  const runs = simulateWindow(report, 20, STREAM);
  const others = Array.from({ length: otherStreams }, (_, index) => simulateWindow(report, 1, { environment: `other-${index}`, origin: 'ci' }, random(100 + index))[0]!);
  const value = deriveEmbedded(report, { runs, others, skipped: 0 }, { include: 'full', stream: STREAM, current: { origin: 'local', excluded: null }, currentRunId: 'current' });
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

  it(`a realistic run (2% failing, two other streams): under ${REALISTIC_LIMIT / 1000} kB gzip`, () => {
    const report = realisticReport();
    const size = measure(template, report, embedded(report, 2));
    if (process.env['LOUPE_MEASURE']) console.log('realistic', size);
    expect(size.alone).toBeLessThan(REALISTIC_LIMIT);
  });

  it(`the perf:sample dataset (56% failing, two other streams): under ${PERF_SAMPLE_LIMIT / 1000} kB gzip`, () => {
    const report = perfSampleReport();
    const value = embedded(report, 2);
    const size = measure(template, report, value);
    if (process.env['LOUPE_MEASURE']) console.log('perf:sample', size, { signatures: value.signatures.length, withExtract: value.signatures.filter(([, , x]) => x !== null).length });
    expect(size.alone).toBeLessThan(PERF_SAMPLE_LIMIT);
  });
});
