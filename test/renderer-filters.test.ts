import { describe, expect, it } from 'vitest';
import {
  facetCounts,
  facetTags,
  filterContext,
  filterDomain,
  filterTests,
  foldText,
  matchTest,
  shownCategories,
  testCategories,
} from '../src/renderer/filters/match.js';
import { nextSort, sortTests } from '../src/renderer/filters/sort.js';
import {
  DEFAULT_SORT,
  EMPTY_FILTERS,
  activeFilterCount,
  clearFilters,
  parseFilters,
  serializeFilters,
  withFacetValue,
  type FacetId,
  type FilterState,
} from '../src/renderer/filters/url.js';
import type { Attempt, AttemptStatus, LoupeError, LoupeReport, TestCase } from '../src/schema/v1.js';

let nextId = 1;

function error(category: string | null): LoupeError {
  return { message: 'Error', stack: null, location: null, snippet: null, signature: `sig-${category}`, category };
}

function attempt(index: number, status: AttemptStatus, errors: LoupeError[] = []): Attempt {
  return {
    index,
    status,
    startedAt: '2026-10-16T00:00:00.000Z',
    durationMs: 100,
    workerIndex: 0,
    errors,
    steps: [],
    attachments: [],
    annotations: [],
    stdout: { text: '', truncated: false },
    stderr: { text: '', truncated: false },
  };
}

function makeTest(fields: Partial<TestCase> = {}): TestCase {
  const id = String(nextId++).padStart(16, '0');
  return {
    id,
    repeatEachIndex: 0,
    project: 'chromium',
    file: 'tests/a.spec.ts',
    line: 1,
    column: 1,
    suitePath: [],
    title: `test ${id}`,
    tags: [],
    annotations: [],
    outcome: 'passed',
    expectedStatus: 'passed',
    durationMs: 100,
    dimensions: {},
    category: null,
    errorSignature: null,
    attempts: [attempt(0, 'passed')],
    ...fields,
  };
}

function failing(categories: Array<string | null>, fields: Partial<TestCase> = {}): TestCase {
  return makeTest({
    outcome: 'failed',
    category: categories[0] ?? null,
    attempts: [attempt(0, 'failed', categories.map(error))],
    ...fields,
  });
}

function state(fields: Partial<FilterState> = {}): FilterState {
  return { ...EMPTY_FILTERS, ...fields };
}

describe('parseFilters / serializeFilters', () => {
  it('reads every parameter', () => {
    expect(parseFilters('#/tests?q=login&status=failed,flaky&project=chromium&tag=@smoke&dim.layer=api,ui&category=Network&sort=duration:desc')).toEqual({
      q: 'login',
      facets: { status: ['failed', 'flaky'], project: ['chromium'], tag: ['@smoke'], 'dim.layer': ['api', 'ui'], category: ['Network'] },
      sort: { column: 'duration', direction: 'desc' },
    });
  });

  it('accepts a raw query, with or without `?`, and a fragment without query', () => {
    expect(parseFilters('status=failed').facets).toEqual({ status: ['failed'] });
    expect(parseFilters('?status=failed').facets).toEqual({ status: ['failed'] });
    expect(parseFilters('#/tests')).toEqual(EMPTY_FILTERS);
    expect(parseFilters('')).toEqual(EMPTY_FILTERS);
  });

  it('writes the canonical form: fixed parameter order, sorted values, empty parameters and default sort left out', () => {
    const query = serializeFilters({
      q: ' login ',
      facets: { category: ['Timeout', 'Network'], 'dim.layer': ['ui', 'api'], tag: [], status: ['flaky', 'failed', 'failed'], 'dim.area': ['checkout'] },
      sort: DEFAULT_SORT,
    });
    expect(query).toBe('q=login&status=failed,flaky&dim.area=checkout&dim.layer=api,ui&category=Network,Timeout');
    expect(serializeFilters(EMPTY_FILTERS)).toBe('');
    expect(serializeFilters(state({ sort: { column: 'title', direction: 'asc' } }))).toBe('sort=title:asc');
  });

  it('gives two equal states the same URL', () => {
    const a = state({ facets: { tag: ['@b', '@a'], status: ['passed'] } });
    const b = state({ facets: { status: ['passed'], tag: ['@a', '@b', '@a'] } });
    expect(serializeFilters(a)).toBe(serializeFilters(b));
  });

  it.each<[string, FilterState]>([
    ['empty', EMPTY_FILTERS],
    ['commas, spaces and special characters', state({ q: 'a, b & c=d ? # %', facets: { tag: ['@a,b', '@c d'], 'dim.my key,x': ['v=1&2', 'ü/ö'] } })],
    ['a sort', state({ facets: { category: ['Uncategorized'] }, sort: { column: 'attempts', direction: 'desc' } })],
    ['a plus sign', state({ q: 'c++', facets: { tag: ['@a+b'] } })],
  ])('round-trips %s', (_, value) => {
    const query = serializeFilters(value);
    const parsed = parseFilters(query);
    expect(parsed).toEqual({ ...value, q: value.q.trim(), facets: Object.fromEntries(Object.entries(value.facets).map(([key, values]) => [key, [...(values ?? [])].sort()])) });
    expect(serializeFilters(parsed)).toBe(query);
  });

  it('keeps a comma inside a value', () => {
    expect(serializeFilters(state({ facets: { tag: ['@a,b'] } }))).toBe('tag=%40a%2Cb');
    expect(parseFilters('tag=%40a%2Cb,@c').facets).toEqual({ tag: ['@a,b', '@c'] });
  });

  it('ignores unknown parameters, malformed values and invalid sorts', () => {
    expect(parseFilters('foo=bar&dim.=x&status=failed&q=%E0%A4%A&tag=%E0%A4%A,@ok&sort=nope:asc&sort=title:sideways')).toEqual(
      state({ facets: { status: ['failed'], tag: ['@ok'] } }),
    );
  });

  it('drops facets and values outside the domain', () => {
    const domain = new Map<FacetId, Set<string>>([
      ['status', new Set(['failed', 'passed'])],
      ['dim.layer', new Set(['api'])],
    ]);
    expect(parseFilters('status=failed,bogus&dim.layer=api,ui&dim.other=x&tag=@smoke', domain).facets).toEqual({ status: ['failed'], 'dim.layer': ['api'] });
  });

  it('reads `+` as a space and merges repeated parameters', () => {
    expect(parseFilters('q=login+page&status=failed&status=flaky')).toEqual(state({ q: 'login page', facets: { status: ['failed', 'flaky'] } }));
  });
});

describe('filter state helpers', () => {
  it('counts the search as one filter, then each value', () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
    expect(activeFilterCount(state({ q: '  ' }))).toBe(0);
    expect(activeFilterCount(state({ q: 'a', facets: { status: ['failed', 'flaky'], tag: ['@x'] } }))).toBe(4);
  });

  it('adds and removes a value, and clears filters but not the sort', () => {
    const sort = { column: 'title', direction: 'desc' } as const;
    const added = withFacetValue(state({ sort }), 'status', 'failed', true);
    expect(added.facets).toEqual({ status: ['failed'] });
    expect(withFacetValue(added, 'status', 'failed', false).facets).toEqual({ status: [] });
    expect(clearFilters({ ...added, q: 'x' })).toEqual({ ...EMPTY_FILTERS, sort });
  });
});

describe('matchTest', () => {
  const login = makeTest({ title: 'logs in', suitePath: ['Authentification', 'Élève'], file: 'tests/auth/login.spec.ts', project: 'firefox' });
  const failed = failing(['Network'], { tags: ['@smoke'], dimensions: { layer: ['api'] } });
  const flaky = makeTest({ outcome: 'flaky', tags: ['@smoke', '@slow'], dimensions: { layer: ['ui'] } });

  it('matches everything without filters', () => {
    expect([login, failed, flaky].every((test) => matchTest(test, EMPTY_FILTERS))).toBe(true);
  });

  it('ORs the values of one facet', () => {
    const value = state({ facets: { status: ['failed', 'flaky'] } });
    expect([login, failed, flaky].map((test) => matchTest(test, value))).toEqual([false, true, true]);
  });

  it('ANDs different facets', () => {
    const value = state({ facets: { tag: ['@smoke'], 'dim.layer': ['ui'] } });
    expect([login, failed, flaky].map((test) => matchTest(test, value))).toEqual([false, false, true]);
  });

  it('requires every search word, as substrings, in the title path, file or project', () => {
    expect(matchTest(login, state({ q: 'auth logs' }))).toBe(true);
    expect(matchTest(login, state({ q: 'login.spec' }))).toBe(true);
    expect(matchTest(login, state({ q: 'fire  IN' }))).toBe(true);
    expect(matchTest(login, state({ q: 'auth checkout' }))).toBe(false);
  });

  it('ignores case and accents, in the search and in the test', () => {
    expect(matchTest(login, state({ q: 'eleve' }))).toBe(true);
    expect(matchTest(login, state({ q: 'ÉLÈVE authentification' }))).toBe(true);
    expect(foldText('Ça Été')).toBe('ca ete');
  });

  it('matches the uncategorized bucket and every category of a test', () => {
    const uncategorized = failing(['Uncategorized']);
    const several = failing(['Timeout', 'Network']);
    expect(matchTest(uncategorized, state({ facets: { category: ['Uncategorized'] } }))).toBe(true);
    expect(matchTest(several, state({ facets: { category: ['Network'] } }))).toBe(true);
    expect(matchTest(login, state({ facets: { category: ['Uncategorized'] } }))).toBe(false);
  });

  it('filters a list the same way', () => {
    expect(filterTests([login, failed, flaky], state({ facets: { tag: ['@smoke'] } }))).toEqual([failed, flaky]);
  });
});

describe('testCategories', () => {
  it('takes the categories of the failing attempts only', () => {
    const flaky = makeTest({ outcome: 'flaky', attempts: [attempt(0, 'failed', [error('Timeout'), error(null)]), attempt(1, 'passed')] });
    expect(testCategories(flaky)).toEqual(['Timeout', 'Uncategorized']);
    // An expected failure (test.fail()) is not a failing attempt.
    const expected = makeTest({ expectedStatus: 'failed', attempts: [attempt(0, 'failed', [error('Assertion')])] });
    expect(testCategories(expected)).toEqual([]);
  });
});

describe('shownCategories', () => {
  it('shows the category of the last failing attempt first, the others apart', () => {
    const test = makeTest({
      outcome: 'failed',
      category: 'Network',
      attempts: [attempt(0, 'failed', [error('Timeout')]), attempt(1, 'failed', [error('Network'), error('Assertion')])],
    });
    expect(shownCategories(test)).toEqual({ primary: 'Network', others: ['Timeout', 'Assertion'] });
  });

  it('has nothing to show for a test that never failed', () => {
    expect(shownCategories(makeTest())).toEqual({ primary: null, others: [] });
  });
});

describe('facetCounts', () => {
  const tests = [
    failing(['Network'], { project: 'a', tags: ['@smoke'] }),
    failing(['Timeout'], { project: 'b', tags: ['@smoke'] }),
    makeTest({ project: 'a', tags: ['@smoke', '@slow'] }),
    makeTest({ project: 'b', outcome: 'skipped' }),
  ];
  const report = { projects: [], dimensions: [], categories: [{ name: 'Timeout', color: '#000000', builtIn: true }, { name: 'Network', color: '#000000', builtIn: true }], tests };
  const domain = filterDomain(report);

  it('counts every value when nothing is filtered', () => {
    const counts = facetCounts(tests, EMPTY_FILTERS, domain);
    expect(Object.fromEntries(counts.get('status') ?? [])).toEqual({ failed: 2, passed: 1, skipped: 1 });
    expect(Object.fromEntries(counts.get('tag') ?? [])).toEqual({ '@slow': 1, '@smoke': 3 });
  });

  it("applies the other filters but not the facet's own selection", () => {
    const counts = facetCounts(tests, state({ facets: { status: ['failed'], project: ['a'] } }), domain);
    // Status counts: project a only, whatever the selected status.
    expect(Object.fromEntries(counts.get('status') ?? [])).toEqual({ failed: 1, passed: 1, skipped: 0 });
    // Project counts: failed tests only, whatever the selected project.
    expect(Object.fromEntries(counts.get('project') ?? [])).toEqual({ a: 1, b: 1 });
    // Other facets: both filters applied.
    expect(Object.fromEntries(counts.get('category') ?? [])).toEqual({ Timeout: 0, Network: 1 });
  });

  it('applies the search to every facet', () => {
    const counts = facetCounts(tests, state({ q: tests[2]?.title ?? '' }), domain);
    expect(Object.fromEntries(counts.get('status') ?? [])).toEqual({ failed: 0, passed: 1, skipped: 0 });
  });
});

describe('filterDomain', () => {
  it('lists the values present, in display order, and leaves out empty facets and unnamed projects', () => {
    const tests = [
      failing(['Network'], { project: 'webkit', tags: ['@b'], dimensions: { Layer: ['zeta', 'api'] } }),
      makeTest({ project: '', tags: ['@a'] }),
      makeTest({ project: 'chromium', outcome: 'skipped' }),
    ];
    const report: Pick<LoupeReport, 'projects' | 'tests' | 'dimensions' | 'categories'> = {
      projects: ['chromium', 'webkit', ''].map((name) => ({ name, testDir: '.', retries: 0, timeoutMs: 0, stats: { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0 } })),
      dimensions: [
        { name: 'Layer', source: 'tag', key: 'layer', values: ['ui', 'api'] },
        { name: 'Bug', source: 'annotation', key: 'bug', values: null },
      ],
      categories: [
        { name: 'Timeout', color: '#000000', builtIn: true },
        { name: 'Network', color: '#000000', builtIn: true },
      ],
      tests,
    };
    // Facets in display order: status, error category, project, tag, then dimensions in report order.
    expect([...filterDomain(report).keys()]).toEqual(['status', 'category', 'project', 'tag', 'dim.Layer']);
    expect(Object.fromEntries([...filterDomain(report)].map(([facet, values]) => [facet, [...values]]))).toEqual({
      status: ['failed', 'passed', 'skipped'],
      project: ['chromium', 'webkit'],
      tag: ['@a', '@b'],
      'dim.Layer': ['api', 'zeta'],
      category: ['Network'],
    });
  });
});

describe('sortTests', () => {
  const a = makeTest({ title: 'b test', outcome: 'passed', durationMs: 300, project: 'x' });
  const b = failing(['Timeout'], { title: 'a test', durationMs: 100, project: 'y' });
  const c = makeTest({ title: 'c test', outcome: 'flaky', durationMs: 200, attempts: [attempt(0, 'failed', [error('Network')]), attempt(1, 'passed')] });
  const d = makeTest({ title: 'a test', outcome: 'skipped', durationMs: 0, project: 'x' });

  it('sorts by status severity, then title, by default', () => {
    expect(sortTests([a, b, c, d], DEFAULT_SORT)).toEqual([b, c, a, d]);
  });

  it('sorts by a column in both directions, ties by title', () => {
    expect(sortTests([a, b, c, d], { column: 'duration', direction: 'desc' })).toEqual([a, c, b, d]);
    expect(sortTests([a, b, c, d], { column: 'title', direction: 'asc' })).toEqual([d, b, a, c]);
    expect(sortTests([a, b, c, d], { column: 'attempts', direction: 'desc' })).toEqual([c, d, b, a]);
  });

  it('puts tests without a category last in both directions', () => {
    expect(sortTests([a, b, c], { column: 'category', direction: 'asc' })).toEqual([c, b, a]);
    expect(sortTests([a, b, c], { column: 'category', direction: 'desc' })).toEqual([b, c, a]);
  });

  it('toggles the direction on the same column, starts numbers descending', () => {
    expect(nextSort(DEFAULT_SORT, 'status')).toEqual({ column: 'status', direction: 'desc' });
    expect(nextSort(DEFAULT_SORT, 'duration')).toEqual({ column: 'duration', direction: 'desc' });
    expect(nextSort(DEFAULT_SORT, 'title')).toEqual({ column: 'title', direction: 'asc' });
  });
});

describe('tags taken by a dimension', () => {
  const dimensions: LoupeReport['dimensions'] = [
    { name: 'Layer', source: 'tag', key: 'layer', values: ['api'] },
    { name: 'Bug', source: 'annotation', key: 'bug', values: null },
  ];
  const context = filterContext({ dimensions });
  const ui = makeTest({ tags: ['@layer:ui', '@smoke', '@area:checkout'], dimensions: { Layer: ['ui'] } });
  const api = makeTest({ tags: ['@layer:api'], dimensions: { Layer: ['api'], Bug: ['BUG-1'] } });
  const report = { projects: [], categories: [], dimensions, tests: [ui, api] };

  it('keeps unprefixed tags and prefixed tags without a dimension, drops those a tag dimension takes', () => {
    expect(facetTags(ui.tags, context)).toEqual(['@smoke', '@area:checkout']);
    expect(facetTags(api.tags, context)).toEqual([]);
    // The raw tags are unchanged.
    expect(ui.tags).toEqual(['@layer:ui', '@smoke', '@area:checkout']);
  });

  it('only takes prefixes of tag dimensions, not annotation types', () => {
    expect(facetTags(['@bug:BUG-1'], context)).toEqual(['@bug:BUG-1']);
  });

  it('lists a taken tag under its dimension only, values outside the declared ones included', () => {
    const domain = filterDomain(report);
    expect([...(domain.get('tag') ?? [])]).toEqual(['@area:checkout', '@smoke']);
    expect([...(domain.get('dim.Layer') ?? [])]).toEqual(['api', 'ui']);
    expect([...(domain.get('dim.Bug') ?? [])]).toEqual(['BUG-1']);
  });

  it('hides the tag facet when every tag belongs to a dimension', () => {
    expect(filterDomain({ ...report, tests: [api] }).has('tag')).toBe(false);
  });

  it('never matches or counts a taken tag through the tag facet', () => {
    expect(matchTest(ui, state({ facets: { tag: ['@layer:ui'] } }), context)).toBe(false);
    expect(matchTest(ui, state({ facets: { tag: ['@smoke'] } }), context)).toBe(true);
    expect(filterTests([ui, api], state({ facets: { 'dim.Layer': ['ui'] } }), context)).toEqual([ui]);
    const counts = facetCounts([ui, api], EMPTY_FILTERS, filterDomain(report), context);
    expect(Object.fromEntries(counts.get('tag') ?? [])).toEqual({ '@area:checkout': 1, '@smoke': 1 });
    expect(Object.fromEntries(counts.get('dim.Layer') ?? [])).toEqual({ api: 1, ui: 1 });
  });

  it('drops a taken tag from the URL, which is then written without it', () => {
    const parsed = parseFilters('tag=%40layer%3Aui,%40smoke&dim.Layer=api', filterDomain(report));
    expect(parsed.facets).toEqual({ tag: ['@smoke'], 'dim.Layer': ['api'] });
    expect(serializeFilters(parsed)).toBe('tag=%40smoke&dim.Layer=api');
  });

  it('keeps every tag without dimensions', () => {
    expect(facetTags(ui.tags, filterContext({ dimensions: [] }))).toEqual(ui.tags);
  });
});
