import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { facetCounts, filterContext, filterDomain, filterTests } from '../src/renderer/filters/match.js';
import { EMPTY_FILTERS, parseFilters, serializeFilters } from '../src/renderer/filters/url.js';
import {
  EXCLUDE_PLACEHOLDER,
  NOTES_INVALID_TEXT,
  NO_STATES_TEXT,
  attemptsText,
  cellName,
  cellUse,
  countersText,
  exclusionCopy,
  exclusionReasons,
  failureGap,
  formatFailedChange,
  formatPoints,
  loadHistory,
  noDeltaText,
  stateCount,
  stateDetail,
  WHICH_RUNS_TEXT,
  streamDefinition,
  streamName,
  type ReportHistory,
} from '../src/renderer/history.js';
import type { LoupeReport } from '../src/schema/v1.js';
import { HISTORY_STATES, type HistoryCell, type HistoryState } from '../src/shared/history.js';
import { historyScenario, type HistoryScenario } from './helpers/history-scenarios.js';

const sample = JSON.parse(readFileSync(new URL('../src/renderer/dev/sample.json', import.meta.url), 'utf8')) as LoupeReport;

/** The report and its history as the page would load them, for a dev scenario. */
function loaded(name: HistoryScenario): { report: LoupeReport; history: ReportHistory | null } {
  const { report, history } = historyScenario(name, sample);
  return { report, history: loadHistory(JSON.stringify(history), report) };
}

describe('loadHistory', () => {
  it('no history: null, an untouched placeholder, invalid JSON, nothing', () => {
    for (const text of ['null', '__LOUPE_HISTORY__', '{', '', undefined, null]) expect(loadHistory(text, sample), String(text)).toBeNull();
  });

  it('a block that does not fit the report: no history', () => {
    const { history } = historyScenario('normal', sample);
    expect(loadHistory(JSON.stringify(history), { ...sample, tests: sample.tests.slice(1) })).toBeNull();
  });

  it('the history of each test, by test', () => {
    const { report, history } = loaded('normal');
    expect(history?.byTest.size).toBe(report.tests.length);
    expect(history?.byTest.get(report.tests[0] as never)).toBe(history?.analysis.tests[0]);
  });
});

describe('the history facet in the URL', () => {
  it('is written after the failure point, its values sorted', () => {
    expect(serializeFilters({ ...EMPTY_FILTERS, facets: { history: ['still-failing', 'fixed'], point: ['a.ts#f'], status: ['failed'] } })).toBe(
      'status=failed&point=a.ts%23f&history=fixed,still-failing',
    );
  });

  it('is read back; without a domain every value is kept', () => {
    expect(parseFilters('history=new-test,fixed').facets).toEqual({ history: ['fixed', 'new-test'] });
  });
});

describe('the history facet in the filter domain', () => {
  it('without history: absent, and a history= parameter is dropped', () => {
    const domain = filterDomain(sample);
    expect(domain.has('history')).toBe(false);
    expect(parseFilters('history=fixed&status=failed', domain).facets).toEqual({ status: ['failed'] });
  });

  it.each(['first-run', 'skipped', 'all-excluded'] as const)('%s: no state shown, so the facet is absent too', (name) => {
    const { report, history } = loaded(name);
    expect(history).not.toBeNull();
    expect(filterDomain(report, history).has('history')).toBe(false);
  });

  it('with states: right after the status, the states present in their fixed order', () => {
    const { report, history } = loaded('normal');
    const domain = filterDomain(report, history);
    expect([...domain.keys()].slice(0, 2)).toEqual(['status', 'history']);
    expect([...(domain.get('history') ?? [])]).toEqual(HISTORY_STATES.filter((state) => (history?.analysis.counts[state] ?? 0) > 0));
  });

  it('leaves out a state no test has', () => {
    const { report, history } = loaded('second-run');
    expect(history?.analysis.counts['still-failing']).toBe(0);
    expect(filterDomain(report, history).get('history')?.has('still-failing')).toBe(false);
  });
});

describe('filtering on history states', () => {
  const { report, history } = loaded('normal');
  const context = filterContext(report, history);
  const domain = filterDomain(report, history);
  const tests = (states: HistoryState[]) => filterTests(report.tests, { ...EMPTY_FILTERS, facets: { history: states } }, context);

  it('OR within the facet: the tests in either state, as many as the dashboard counts', () => {
    const counts = history?.analysis.counts as Record<HistoryState, number>;
    expect(tests(['fixed'])).toHaveLength(counts.fixed);
    expect(tests(['fixed', 'new-failure'])).toHaveLength(counts.fixed + counts['new-failure']);
    expect(tests(['still-failing']).every((test) => history?.byTest.get(test)?.state === 'still-failing')).toBe(true);
  });

  it('AND across facets: fixed tests are not failing', () => {
    expect(filterTests(report.tests, { ...EMPTY_FILTERS, facets: { history: ['fixed'], status: ['failed'] } }, context)).toEqual([]);
  });

  it('counts per state, as the facet menu shows them', () => {
    expect(Object.fromEntries(facetCounts(report.tests, EMPTY_FILTERS, domain, context).get('history') ?? [])).toEqual(
      Object.fromEntries(HISTORY_STATES.map((state) => [state, history?.analysis.counts[state]]).filter(([, count]) => (count as number) > 0)),
    );
  });

  it('a test without a state has no value', () => {
    const passing = report.tests.find((test) => history?.byTest.get(test)?.state === null);
    expect(passing && filterContext(report, history).historyStates.has(passing)).toBe(false);
  });
});

describe('verdict history texts', () => {
  it('state counts', () => {
    expect(['new-failure', 'new-test', 'failed-again', 'still-failing', 'fixed'].map((state) => stateCount(state as HistoryState, 1))).toEqual([
      '1 new failure',
      '1 new test',
      '1 failed again',
      '1 still failing',
      '1 fixed',
    ]);
    expect(stateCount('new-failure', 3)).toBe('3 new failures');
    expect(stateCount('still-failing', 0)).toBe('0 still failing');
  });

  it('the pass rate change in points, the failed tests change', () => {
    expect([formatPoints(3), formatPoints(-1.54), formatPoints(1), formatPoints(0.04), formatPoints(-0.04)]).toEqual(['+3 pts', '−1.5 pts', '+1 pt', 'no change', 'no change']);
    expect([formatFailedChange(-2), formatFailedChange(1), formatFailedChange(0)]).toEqual(['2 fewer failed tests', '1 more failed test', 'as many failed tests']);
  });

  it('why there is no delta, why no state is shown; never a cause', () => {
    const none = { excluded: null };
    expect(noDeltaText('current-excluded', { excluded: 'staging restored' }, 'full')).toBe('This run is excluded (staging restored): it is not compared with earlier runs.');
    expect(noDeltaText('current-excluded', { excluded: null, notesExcluded: 'bad merge' }, 'full')).toBe('This run is excluded (bad merge, from loupe.notes.json): it is not compared with earlier runs.');
    expect(noDeltaText('current-excluded', { excluded: 'restore', notesExcluded: 'bad merge' }, 'full')).toBe(
      'This run is excluded (restore, at launch; bad merge, from loupe.notes.json): it is not compared with earlier runs.',
    );
    expect(noDeltaText('no-earlier-run', none, 'full')).toBe('No earlier full run in this stream to compare with.');
    expect(noDeltaText('no-earlier-run', none, 'all')).toBe('No earlier run in this stream to compare with.');
    expect(NO_STATES_TEXT['first-run']).toBe('First run of this stream: nothing to compare yet.');
    expect(NO_STATES_TEXT['all-excluded']).toBe("Every earlier run of this stream is excluded (with LOUPE_EXCLUDE or in loupe.notes.json); history.include: 'all' counts them.");
    expect(NOTES_INVALID_TEXT).toBe('loupe.notes.json could not be read: its entries are ignored (see the run output).');
    for (const text of [...Object.values(NO_STATES_TEXT), noDeltaText('current-ide', none, 'full'), noDeltaText('current-partial', none, 'full')]) {
      expect(text).not.toMatch(/root cause|because of/i);
    }
  });

  it('the stream by its key parts in words, an unknown branch named', () => {
    expect(streamName({ environment: 'staging', origin: 'ci' })).toBe('staging, CI');
    expect(streamName({ environment: 'default', origin: 'ide' })).toBe('default environment, IDE');
    expect(streamName({ environment: 'staging', origin: 'local', branch: null })).toBe('staging, local, no branch');
    expect(streamName({ origin: 'ci', branch: 'main' })).toBe('CI, branch main');
  });

  it('which runs are used, as history.include sets it', () => {
    expect(WHICH_RUNS_TEXT.full).toMatch(/^Run comparisons .* use full runs outside the IDE that are not excluded \(with LOUPE_EXCLUDE or in loupe\.notes\.json\)\. A test's history .* except excluded ones\.$/);
    expect(WHICH_RUNS_TEXT.all).toMatch(
      /^Run comparisons .* use every run, partial, excluded \(with LOUPE_EXCLUDE or in loupe\.notes\.json\) and IDE runs included, because history\.include is 'all'\. A test's history .* excluded ones included\.$/,
    );
  });

  it('what a stream is, from the parts of its key', () => {
    expect(streamDefinition({ environment: 'default', origin: 'local' })).toBe('A stream is an environment plus an origin (CI, local, IDE); each has its own history.');
    expect(streamDefinition({ environment: 'x', origin: 'ci', branch: 'main' })).toMatch(/^A stream is an environment plus an origin \(CI, local, IDE\) plus a branch;/);
  });
});

describe('test detail texts', () => {
  const run = { origin: 'ci', excluded: null, scopeReasons: [] } as unknown as HistoryCell['run'];
  const cell = (fields: Partial<HistoryCell> = {}): HistoryCell =>
    ({ index: 0, run, code: 'F', attempts: 'FT', flags: [], runCounts: true, counts: true, failure: { category: 'Timeout', extract: 'x', compared: true }, ...fields }) as HistoryCell;

  it('the name of a cell: date, origin, result, category, then how a run drawn apart is used', () => {
    expect(cellName(cell(), '12 Nov 14:03', 'full')).toBe('12 Nov 14:03, CI, failed, Timeout');
    expect(cellName(cell({ code: 'P', failure: null, attempts: 'P' }), 'd', 'full')).toBe('d, CI, passed');
    expect(cellName(cell({ code: '-', failure: null, attempts: null }), 'd', 'full')).toBe('d, CI, no result');
    const excluded = { ...run, excluded: 'restore' };
    expect(cellName(cell({ run: excluded, flags: ['excluded'], runCounts: false, counts: false }), 'd', 'full')).toBe(
      "d, CI, failed, Timeout, excluded run (restore): not used in this test's history",
    );
  });

  it('how a run is used: nothing for an ordinary run, one sentence otherwise', () => {
    expect(cellUse(cell(), 'full')).toBeNull();
    expect(cellUse(cell(), 'all')).toBeNull();
    const partial = { ...run, scopeReasons: ['grep', 'project'] };
    expect(cellUse(cell({ run: partial, flags: ['partial'] }), 'full')).toBe("Partial run (grep, project): used in this test's history, not in run comparisons");
    expect(cellUse(cell({ flags: ['ide'] }), 'full')).toBe("Run from the IDE: used in this test's history, not in run comparisons");
    expect(cellUse(cell({ run: partial, flags: ['ide', 'partial'] }), 'full')).toBe("Partial run from the IDE (grep, project): used in this test's history, not in run comparisons");
    expect(cellUse(cell({ run: { ...run, excluded: 'x' }, flags: ['excluded'], runCounts: false }), 'full')).toBe("Excluded run (x): not used in this test's history");
    expect(cellUse(cell({ run: { ...run, excluded: 'x' }, flags: ['excluded'], runCounts: true }), 'all')).toBe("Excluded run (x): used, because history.include is 'all'");
    // With include: 'all', run comparisons use partial and IDE runs too.
    expect(cellUse(cell({ flags: ['ide'] }), 'all')).toBe("Run from the IDE: used, because history.include is 'all'");
    for (const flags of [['ide'], ['partial']] as const) expect(cellUse(cell({ run: partial, flags: [...flags] }), 'full')).not.toMatch(/not used/);
  });

  it('an exclusion says where it comes from: the launch wording unchanged, the file named, both with their sources', () => {
    expect(exclusionReasons({ excluded: 'restore' })).toBe('restore');
    expect(exclusionReasons({ excluded: null, notesExcluded: 'VPN' })).toBe('VPN, from loupe.notes.json');
    expect(exclusionReasons({ excluded: 'restore', notesExcluded: 'VPN' })).toBe('restore, at launch; VPN, from loupe.notes.json');
    const fromFile = { ...run, notesExcluded: 'staging down' };
    expect(cellUse(cell({ run: fromFile, flags: ['excluded'], runCounts: false }), 'full')).toBe("Excluded run (staging down, from loupe.notes.json): not used in this test's history");
    expect(cellUse(cell({ run: fromFile, flags: ['excluded'], runCounts: true }), 'all')).toBe("Excluded run (staging down, from loupe.notes.json): used, because history.include is 'all'");
    const both = { ...run, excluded: 'restore', notesExcluded: 'staging down' };
    expect(cellName(cell({ run: both, flags: ['excluded'], runCounts: false, counts: false }), 'd', 'full')).toBe(
      "d, CI, failed, Timeout, excluded run (restore, at launch; staging down, from loupe.notes.json): not used in this test's history",
    );
    // A note alone: an ordinary run, whose name says nothing more.
    expect(cellUse(cell({ run: { ...run, note: 'after the refactor' } }), 'full')).toBeNull();
  });

  it('why a failure shows no error text', () => {
    expect(failureGap(cell({ failure: { category: null, extract: null, compared: false } }))).toMatch(/^Error not compared: /);
    expect(failureGap(cell({ failure: { category: 'Timeout', extract: null, compared: true } }))).toMatch(/^Error text not kept: .*300/);
    expect(failureGap(cell())).toBeNull();
    expect(failureGap(cell({ failure: null }))).toBeNull();
  });

  it('attempts, counters, the state with its N', () => {
    expect([attemptsText('FTP'), attemptsText('P'), attemptsText(null)]).toEqual(['3 attempts: failed, timed out, passed', '1 attempt: passed', null]);
    expect(countersText({ failures: 5, statusChanges: 9, passedOnRetry: 3, considered: 20 }, true)).toBe('Failed 5 of the last 20 runs · changed status 9 times · passed on retry 3 times');
    expect(countersText({ failures: 1, statusChanges: 1, passedOnRetry: 0, considered: 1 }, true)).toBe('Failed 1 of the last 1 run · changed status once · passed on retry 0 times');
    // Without retries in the stream, no retry counter: "passed on retry 0 times" would say nothing.
    expect(countersText({ failures: 5, statusChanges: 9, passedOnRetry: 0, considered: 20 }, false)).toBe('Failed 5 of the last 20 runs · changed status 9 times');
    expect(stateDetail('new-failure', 7)).toBe('no failure in its last 7 runs in this stream');
    for (const state of HISTORY_STATES) expect(stateDetail(state, 3)).not.toMatch(/root cause|because/i);
  });
});

describe('the exclusion copied for the current run', () => {
  const current = { origin: 'local' as const, excluded: null, id: 'github-actions-1234567890-3f9a2c1d' };
  const copy = (notesFile: 'absent' | 'read' | 'invalid' | 'off', notesPath: string | null = 'loupe.notes.json', id: string | null = current.id) =>
    exclusionCopy({ current: { ...current, id }, notesFile, notesPath });

  it("the current run's id, escaped as JSON, and a reason to replace", () => {
    const entry = `{ "run": "${current.id}", "exclude": "${EXCLUDE_PLACEHOLDER}" }`;
    expect(copy('read')?.text).toBe(`${entry},`);
    expect(copy('invalid')?.text).toBe(`${entry},`);
    expect(JSON.parse(copy('absent')?.text ?? '')).toEqual({ notesVersion: 1, runs: [{ run: current.id, exclude: EXCLUDE_PLACEHOLDER }] });
    expect(exclusionCopy({ current: { ...current, id: 'a"b\\c' }, notesFile: 'read', notesPath: 'loupe.notes.json' })?.text).toContain('"run": "a\\"b\\\\c"');
  });

  it('where it goes: pasted into the file, or saved next to the config or at a path relative to its folder', () => {
    expect(copy('read', 'e2e/notes.json')?.instruction).toBe('Paste it after "runs": [ in e2e/notes.json and commit it: it applies from the next run.');
    expect(copy('absent')?.instruction).toBe('Save it as loupe.notes.json next to the Playwright config and commit it: it applies from the next run.');
    expect(copy('absent', '../shared/loupe.notes.json')?.instruction).toBe(
      "Save it as ../shared/loupe.notes.json, relative to the Playwright config's folder, and commit it: it applies from the next run.",
    );
  });

  it('nothing to copy: history.notes: false, a run not recorded, no path', () => {
    expect(copy('off', null)).toBeNull();
    expect(copy('off')).toBeNull();
    expect(copy('read', 'loupe.notes.json', null)).toBeNull();
    expect(copy('read', null)).toBeNull();
    expect(copy('absent', '')).toBeNull();
  });
});
