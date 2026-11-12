/**
 * Named history scenarios for the renderer's dev server (`?history=<name>`,
 * vite.config.ts): run files built here, derived into the embedded block by
 * the real `deriveEmbedded`, as a report would have it. Deterministic: the
 * same report gives the same block. Node only (the dev server's config), never
 * imported by the renderer.
 */
import { deriveEmbedded } from '../../src/core/history/embed.js';
import type { EmbeddedHistory, HistoryRun, HistoryRunFile, HistoryTest } from '../../src/schema/history-v1.js';
import type { LoupeReport, TestCase } from '../../src/schema/v1.js';
import { makeRunFile } from './history.js';

export const HISTORY_SCENARIOS = [
  'none',
  'first-run',
  'normal',
  'alternating',
  'broken',
  'no-retries',
  'several-streams',
  'version-break',
  'current-partial',
  'all-partial',
  'ide',
  'skipped',
  'skipped-some',
  'all-excluded',
] as const;
export type HistoryScenario = (typeof HISTORY_SCENARIOS)[number];

/** What each scenario shows, for the dev server's message. */
export const SCENARIO_HELP: Record<HistoryScenario, string> = {
  none: 'no history: the block is null',
  'first-run': 'the run after history was enabled: one earlier run',
  normal: 'a local stream of 20 runs, with a partial, an excluded and an ide run among them',
  alternating: 'normal, every failing test alternating pass and fail',
  broken: 'normal, every failing test passing for 15 runs, then failing for 5',
  'no-retries': 'normal, no retries in any run or now',
  'several-streams': 'normal, plus the latest run of three other streams',
  'version-break': "normal, the 8 oldest runs written with another signature version",
  'current-partial': 'normal, the current run partial (no delta)',
  'all-partial': 'every run partial (--project chromium-a), the current one too: test states, no delta',
  ide: 'an ide stream: every run from the IDE, the current one too: test states, no delta',
  skipped: 'every run file of the window skipped (written by a newer Loupe): no test states',
  'skipped-some': 'normal, the window shortened to 17 runs by 3 skipped files: test states and the skipped notice',
  'all-excluded': 'every earlier run excluded: no test states',
};

const STREAM: HistoryRun['stream'] = { environment: 'default', origin: 'local' };
const RUNS = 20;
const DAY = 24 * 60 * 60 * 1000;

type Code = HistoryTest['o'] | '-';
/** The code of a test in past run `run` (0 the oldest), from its index among the report's tests. */
type Pattern = (test: TestCase, index: number, run: number) => Code;

/**
 * The default pattern: failing tests in turn still failing, failed again,
 * new failure and new test; one passing test in five fixed; flaky tests
 * flaky now and then; skipped tests skipped.
 */
const normal: Pattern = (test, index, run) => {
  if (test.outcome === 'skipped') return 'S';
  if (test.outcome === 'flaky') return run % 3 === 0 ? 'K' : 'P';
  if (test.outcome === 'passed') return index % 5 === 0 && run === RUNS - 1 ? 'F' : run % 7 === 3 && index % 3 === 0 ? 'K' : 'P';
  switch (index % 4) {
    case 0:
      return run >= RUNS - 3 || run % 6 === 1 ? 'F' : 'P';
    case 1:
      return run === RUNS - 1 ? 'P' : run % 5 === 2 ? 'F' : 'P';
    case 2:
      return 'P';
    default:
      return '-';
  }
};

const failingAs = (failing: (run: number) => Code): Pattern => (test, index, run) => (test.outcome === 'failed' ? failing(run) : normal(test, index, run));

function row(test: TestCase, code: HistoryTest['o'], run: number): HistoryTest {
  const base: HistoryTest = { id: test.id, t: [test.project, test.file, ...test.suitePath, test.title], o: code, d: test.durationMs };
  if (test.repeatEachIndex !== 0) base.r = test.repeatEachIndex;
  if (code !== 'F' && code !== 'K') return base;
  const error = test.attempts.flatMap((attempt) => attempt.errors)[0];
  // Its own error most of the time, another one every fourth run.
  const own = test.errorSignature !== null && run % 4 !== 0;
  return {
    ...base,
    a: code === 'F' ? 'FF' : 'FP',
    f: [{ i: 0, sig: [own ? (test.errorSignature as string) : `other-${test.id}-${run}`], cat: own ? (error?.category ?? null) : 'Network', x: own ? (error?.message.slice(0, 300) ?? 'Error') : `Error: connect ECONNREFUSED (run ${run})`, at: null }],
  };
}

interface RunOptions {
  pattern: Pattern;
  /** Run metadata of past run `run`. */
  run?: (run: number) => Partial<HistoryRun>;
  signatureVersion?: (run: number) => number;
  stream?: HistoryRun['stream'];
  count?: number;
}

/** Past runs, newest first as the reader gives them, the newest one a day before the report. */
function pastRuns(report: LoupeReport, { pattern, run: meta = () => ({}), signatureVersion = () => 6, stream = STREAM, count = RUNS }: RunOptions): HistoryRunFile[] {
  const end = Date.parse(report.run.startedAt);
  const files: HistoryRunFile[] = [];
  for (let run = 0; run < count; run++) {
    const tests: HistoryTest[] = [];
    const stats = { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0 };
    report.tests.forEach((test, index) => {
      const code = pattern(test, index, run);
      if (code === '-') return;
      tests.push(row(test, code, run));
      stats.total++;
      stats[({ P: 'passed', F: 'failed', K: 'flaky', S: 'skipped' } as const)[code]]++;
    });
    const startedAt = new Date(end - (count - run) * DAY + run * 37 * 60 * 1000).toISOString();
    const file = makeRunFile(
      {
        id: `dev-${stream['origin'] ?? 'x'}-${run}`,
        reportRunId: `00000000-0000-4000-8000-${String(run).padStart(12, '0')}`,
        startedAt,
        durationMs: 60_000 + run * 1000,
        status: stats.failed > 0 ? 'failed' : 'passed',
        origin: (stream['origin'] as HistoryRun['origin'] | undefined) ?? 'local',
        stream,
        stats,
        projects: report.projects.map((project) => ({ name: project.name, retries: project.retries })),
        git: { commit: `${(0xabc1230 + run).toString(16)}0000000000000000000000000000000000`.slice(0, 40), branch: 'main' },
        ...meta(run),
      },
      tests,
    );
    files.push({ ...file, signatureVersion: signatureVersion(run) });
  }
  return files.reverse();
}

/** The flags of the normal stream: run 5 partial, run 9 excluded, run 13 from the IDE. */
const mixedRuns = (run: number): Partial<HistoryRun> =>
  run === 5 ? { scope: 'partial', scopeReasons: ['grep'] } : run === 9 ? { excluded: { reason: 'staging database restored during the run' } } : run === 13 ? { origin: 'ide' } : {};

/** In the partial run of the normal stream, only the tests that match the grep ran. */
const withGrep = (pattern: Pattern): Pattern => (test, index, run) => (run === 5 && index % 2 === 1 ? '-' : pattern(test, index, run));

const full = (report: LoupeReport): LoupeReport => ({ ...report, run: { ...report.run, scope: 'full', scopeReasons: [] } });

/**
 * The report and the block of a scenario. The sample's own run is partial:
 * most scenarios make it full, so that the verdict has a delta.
 */
export function historyScenario(name: HistoryScenario, sample: LoupeReport): { report: LoupeReport; history: EmbeddedHistory | null } {
  let report = full(sample);
  let current: EmbeddedHistory['current'] = { origin: 'local', excluded: null };
  let runs: HistoryRunFile[] = [];
  let others: HistoryRunFile[] = [];
  let skipped = 0;
  const stream = (pattern: Pattern, extra: Partial<RunOptions> = {}) => pastRuns(report, { pattern: withGrep(pattern), run: mixedRuns, ...extra });

  switch (name) {
    case 'none':
      return { report: sample, history: null };
    case 'first-run':
      runs = pastRuns(report, { pattern: normal, count: 1 });
      break;
    case 'normal':
      runs = stream(normal);
      break;
    case 'alternating':
      runs = stream(failingAs((run) => (run % 2 === 0 ? 'F' : 'P')));
      break;
    case 'broken':
      runs = stream(failingAs((run) => (run >= RUNS - 5 ? 'F' : 'P')));
      break;
    case 'no-retries':
      report = { ...report, projects: report.projects.map((project) => ({ ...project, retries: 0 })) };
      runs = stream(normal, { run: (run) => ({ ...mixedRuns(run), projects: report.projects.map((project) => ({ name: project.name, retries: 0 })) }) });
      break;
    case 'several-streams':
      runs = stream(normal);
      others = [
        pastRuns(report, { pattern: normal, count: 1, stream: { environment: 'staging', origin: 'ci' } }),
        pastRuns(report, { pattern: (test, index, run) => (index % 3 === 0 ? '-' : normal(test, index, run)), count: 1, stream: { environment: 'production', origin: 'ci' } }),
        pastRuns(report, { pattern: (test) => (test.outcome === 'failed' ? 'F' : 'P'), count: 1, stream: { environment: 'default', origin: 'ide' } }),
      ].map((files) => files[0] as HistoryRunFile);
      break;
    case 'version-break':
      runs = stream(normal, { signatureVersion: (run) => (run < 8 ? 5 : 6) });
      break;
    case 'current-partial':
      report = sample;
      runs = stream(normal);
      break;
    case 'all-partial': {
      // `--project chromium-a` every time: the other project's tests never ran.
      report = sample;
      const project = sample.projects[0]?.name;
      runs = pastRuns(report, { pattern: (test, index, run) => (test.project === project ? normal(test, index, run) : '-'), run: () => ({ scope: 'partial', scopeReasons: ['project'] }) });
      break;
    }
    case 'ide': {
      const ide = { environment: 'default', origin: 'ide' };
      current = { origin: 'ide', excluded: null };
      runs = pastRuns(report, { pattern: normal, stream: ide });
      break;
    }
    case 'skipped':
      skipped = 3;
      break;
    case 'skipped-some':
      // The 3 newest files of the window could not be read: 17 runs left.
      runs = stream(normal).slice(3);
      skipped = 3;
      break;
    case 'all-excluded':
      runs = pastRuns(report, { pattern: normal, run: (run) => ({ excluded: { reason: `maintenance window ${run}` } }) });
      break;
  }
  const streamOfRuns = name === 'ide' ? { environment: 'default', origin: 'ide' } : STREAM;
  return { report, history: deriveEmbedded(report, { runs, others, skipped }, { include: 'full', stream: streamOfRuns, current, currentRunId: 'current' }) };
}
