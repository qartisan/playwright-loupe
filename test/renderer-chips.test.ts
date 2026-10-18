import { describe, expect, it } from 'vitest';
import { CHIP_CAP, chipFilters, collapsedChips, isChipActive, reportChips, testChips } from '../src/renderer/filters/chips.js';
import { filterContext } from '../src/renderer/filters/match.js';
import { EMPTY_FILTERS, parseFilters, serializeFilters, type FilterState } from '../src/renderer/filters/url.js';
import type { DimensionDefinition } from '../src/schema/v1.js';

const DIMENSIONS: DimensionDefinition[] = [
  { name: 'Layer', source: 'tag', key: 'layer', values: ['api', 'ui'] },
  { name: 'Bug', source: 'annotation', key: 'bug', values: null },
  { name: 'area', source: 'tag', key: 'area', values: null },
];
const CONTEXT = filterContext({ dimensions: DIMENSIONS });

describe('testChips', () => {
  it('lists dimension values in config order, values in the test order, then free tags sorted', () => {
    const chips = testChips(
      {
        tags: ['@smoke', '@area:checkout', '@layer:ui', '@layer:api', '@flaky-env', '@Auth'],
        // Object key order differs from the config order on purpose.
        dimensions: { area: ['checkout'], Bug: ['BUG-12'], Layer: ['ui', 'api'] },
      },
      DIMENSIONS,
      CONTEXT,
    );
    expect(chips.map((chip) => chip.label)).toEqual(['ui', 'api', 'BUG-12', 'checkout', '@Auth', '@flaky-env', '@smoke']);
    expect(chips[0]).toEqual({ facet: 'dim.Layer', value: 'ui', label: 'ui', name: 'Layer: ui' });
    expect(chips[2]).toEqual({ facet: 'dim.Bug', value: 'BUG-12', label: 'BUG-12', name: 'Bug: BUG-12' });
    expect(chips[4]).toEqual({ facet: 'tag', value: '@Auth', label: '@Auth', name: 'Tag: @Auth' });
  });

  it('never shows a tag a dimension takes as a free tag too', () => {
    const chips = testChips({ tags: ['@layer:api', '@smoke'], dimensions: { Layer: ['api'] } }, DIMENSIONS, CONTEXT);
    expect(chips.map((chip) => chip.name)).toEqual(['Layer: api', 'Tag: @smoke']);
  });

  it('keeps a prefixed tag no dimension takes as a free tag', () => {
    const chips = testChips({ tags: ['@team:payments'], dimensions: {} }, DIMENSIONS, CONTEXT);
    expect(chips.map((chip) => chip.name)).toEqual(['Tag: @team:payments']);
  });

  it('includes annotation-based dimensions, and is empty when there is nothing to show', () => {
    expect(testChips({ tags: [], dimensions: { Bug: ['BUG-1', 'BUG-2'] } }, DIMENSIONS, CONTEXT).map((chip) => chip.name)).toEqual(['Bug: BUG-1', 'Bug: BUG-2']);
    expect(testChips({ tags: [], dimensions: {} }, DIMENSIONS, CONTEXT)).toEqual([]);
    expect(testChips({ tags: [], dimensions: { Layer: [] } }, DIMENSIONS, CONTEXT)).toEqual([]);
  });
});

describe('chip links', () => {
  const api = { facet: 'dim.Layer', value: 'api' } as const;
  const smoke = { facet: 'tag', value: '@smoke' } as const;
  const state = (query: string): FilterState => parseFilters(query);

  it('adds the value to an empty filter', () => {
    expect(isChipActive(EMPTY_FILTERS, api)).toBe(false);
    expect(serializeFilters(chipFilters(EMPTY_FILTERS, api))).toBe('dim.Layer=api');
    expect(serializeFilters(chipFilters(EMPTY_FILTERS, smoke))).toBe('tag=%40smoke');
  });

  it('adds the value to an existing facet, in canonical order', () => {
    expect(serializeFilters(chipFilters(state('dim.Layer=ui'), api))).toBe('dim.Layer=api,ui');
  });

  it('removes an active value', () => {
    const current = state('dim.Layer=api,ui');
    expect(isChipActive(current, api)).toBe(true);
    expect(serializeFilters(chipFilters(current, api))).toBe('dim.Layer=ui');
    expect(serializeFilters(chipFilters(state('dim.Layer=api'), api))).toBe('');
  });

  it('keeps the search, the other facets and the sort', () => {
    const current = state('q=login&status=failed&tag=%40smoke&category=Timeout&sort=duration:desc');
    expect(serializeFilters(chipFilters(current, api))).toBe('q=login&status=failed&tag=%40smoke&dim.Layer=api&category=Timeout&sort=duration:desc');
    expect(serializeFilters(chipFilters(current, smoke))).toBe('q=login&status=failed&category=Timeout&sort=duration:desc');
  });
});

describe('reportChips', () => {
  it('computes the chips of each test once per report, by test id', () => {
    const report = { dimensions: DIMENSIONS, tests: [{ id: 'a', tags: ['@smoke', '@layer:api'], dimensions: { Layer: ['api'] } }] } as never;
    const index = reportChips(report);
    expect(index.get('a')?.map((chip) => chip.name)).toEqual(['Layer: api', 'Tag: @smoke']);
    expect(reportChips(report)).toBe(index);
  });
});

describe('collapsedChips', () => {
  const chips = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const none = (): boolean => false;

  it('shows the first chips up to the cap, and counts the others', () => {
    expect(CHIP_CAP).toBe(4);
    expect(collapsedChips(chips, none)).toEqual({ shown: ['a', 'b', 'c', 'd'], hidden: 3 });
    expect(collapsedChips(['a', 'b', 'c', 'd'], none)).toEqual({ shown: ['a', 'b', 'c', 'd'], hidden: 0 });
    expect(collapsedChips([], none)).toEqual({ shown: [], hidden: 0 });
  });

  it('always shows active chips, fills the other slots in order, and keeps the relative order', () => {
    expect(collapsedChips(chips, (chip) => chip === 'f')).toEqual({ shown: ['a', 'b', 'c', 'f'], hidden: 3 });
    expect(collapsedChips(chips, (chip) => chip === 'b' || chip === 'g')).toEqual({ shown: ['a', 'b', 'c', 'g'], hidden: 3 });
    expect(collapsedChips(chips, (chip) => chip === 'a')).toEqual({ shown: ['a', 'b', 'c', 'd'], hidden: 3 });
  });

  it('shows every active chip even beyond the cap, and counts only the chips actually hidden', () => {
    expect(collapsedChips(chips, (chip) => ['b', 'd', 'e', 'f', 'g'].includes(chip))).toEqual({ shown: ['b', 'd', 'e', 'f', 'g'], hidden: 2 });
    expect(collapsedChips(chips, () => true)).toEqual({ shown: chips, hidden: 0 });
  });
});
