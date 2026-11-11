import { readFileSync } from 'node:fs';
import path from 'node:path';
import { extract } from '../../src/core/history/runFile.js';
import type { HistoryRunFile, HistoryTest } from '../../src/schema/history-v1.js';
import type { LoupeReport, TestCase } from '../../src/schema/v1.js';
import { ROOT } from './fixtures.js';
import { makeRunFile } from './history.js';

/** Deterministic pseudo-random numbers in [0, 1). */
export function random(seed = 42): () => number {
  let state = seed;
  return () => (state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}

const hex = (rnd: () => number, length: number) => Array.from({ length }, () => '0123456789abcdef'[Math.floor(rnd() * 16)]).join('');

const sample = (): LoupeReport => JSON.parse(readFileSync(path.join(ROOT, 'src/renderer/dev/sample.json'), 'utf8')) as LoupeReport;

/** The `sample` dataset of `npm run perf:sample` (scripts/perf-sample.mjs): the fixture sample repeated to 5,000 tests, 56% failing. */
export function perfSampleReport(count = 5000): LoupeReport {
  const base = sample();
  const tests = Array.from({ length: count }, (_, index) => {
    const test = base.tests[index % base.tests.length] as TestCase;
    return { ...test, id: index.toString(16).padStart(16, '0'), title: `${test.title} #${index}` };
  });
  return { ...base, tests };
}

/** A realistic large suite, as brief 23 modelled it: 2% failed, 1% flaky, 3% skipped, the rest passed. */
export function realisticReport(count = 5000, rnd = random(7)): LoupeReport {
  const base = sample();
  const pools = {
    failed: base.tests.filter((test) => test.outcome === 'failed'),
    flaky: base.tests.filter((test) => test.outcome === 'flaky'),
    skipped: base.tests.filter((test) => test.outcome === 'skipped'),
    passed: base.tests.filter((test) => test.outcome === 'passed'),
  };
  const tests = Array.from({ length: count }, (_, index) => {
    const x = rnd();
    const pool = x < 0.02 ? pools.failed : x < 0.03 ? pools.flaky : x < 0.06 ? pools.skipped : pools.passed;
    const test = pool[index % pool.length] as TestCase;
    return { ...test, id: hex(rnd, 16), title: `${test.title} #${index}` };
  });
  return { ...base, tests };
}

/**
 * `runs` past run files of the report's tests, newest first, in one stream
 * (brief 23's model): a test failing now failed in 60% of past runs, 70% of
 * those with its own signature; a flaky test was flaky in 30%; a passing test
 * failed 2%, was flaky 1% and had no result 1%. Other failures get a new
 * signature and a new extract.
 */
export function simulateWindow(report: LoupeReport, runs = 20, stream: HistoryRunFile['run']['stream'] = { environment: 'default', origin: 'local' }, rnd = random(42)): HistoryRunFile[] {
  const messages = report.tests.flatMap((test) => test.attempts.flatMap((attempt) => attempt.errors.map((error) => ({ message: error.message, category: error.category }))));
  const day = 24 * 60 * 60 * 1000;
  const start = Date.parse('2026-11-01T00:00:00.000Z');
  return Array.from({ length: runs }, (_, k) => {
    const tests: HistoryTest[] = [];
    for (const test of report.tests) {
      const x = rnd();
      let code: HistoryTest['o'] | null;
      if (test.outcome === 'skipped') code = 'S';
      else if (test.outcome === 'failed') code = x < 0.6 ? 'F' : 'P';
      else if (test.outcome === 'flaky') code = x < 0.3 ? 'K' : 'P';
      else code = x < 0.02 ? 'F' : x < 0.03 ? 'K' : x < 0.04 ? null : 'P';
      if (code === null) continue;
      const row: HistoryTest = { id: test.id, t: [test.project, test.file, ...test.suitePath, test.title], o: code, d: test.durationMs };
      if (test.repeatEachIndex !== 0) row.r = test.repeatEachIndex;
      if (code === 'F' || code === 'K') {
        row.a = code === 'F' ? 'FF' : 'FP';
        const own = test.errorSignature !== null && rnd() < 0.7;
        const picked = messages[Math.floor(rnd() * messages.length)] ?? { message: 'Error: failed', category: null };
        const ownError = test.attempts.flatMap((attempt) => attempt.errors)[0];
        row.f = [
          {
            i: 0,
            sig: [own ? (test.errorSignature as string) : hex(rnd, 12)],
            cat: own ? (ownError?.category ?? null) : picked.category,
            x: extract(own ? (ownError?.message ?? picked.message) : `${picked.message} ${hex(rnd, 10)}`),
            at: null,
          },
        ];
      }
      tests.push(row);
    }
    return makeRunFile({ id: `${hex(rnd, 8)}-${hex(rnd, 4)}-4${hex(rnd, 3)}-8${hex(rnd, 3)}-${hex(rnd, 12)}`, startedAt: new Date(start - k * day).toISOString(), stream }, tests);
  });
}
