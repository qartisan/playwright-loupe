import type { DimensionDefinition, LoupeReport, TestCase } from '../../schema/v1.js';
import { facetTags, filterContext, type FilterContext } from './match.js';
import { dimensionFacet, withFacetValue, type FacetId, type FilterState } from './url.js';

/**
 * The chips of a row of the Tests view: what the test covers. First its
 * dimension values, dimensions in report order (configured ones in config
 * order), values in the test's order; then its free tags, sorted. A tag a
 * dimension takes appears only as that dimension's value, as in the filters.
 * Other annotations stay in the test detail.
 *
 * Each chip toggles its value in the filter state: added when not selected,
 * removed when it is. A collapsed row always shows its active chips.
 *
 * Pure functions, no DOM: unit-tested in Node.
 */

export interface TestChip {
  facet: FacetId;
  value: string;
  /** Shown on the chip: the value alone (`api`), a tag with its `@`. */
  label: string;
  /** The facet and the value, for the tooltip and the accessible name: `Layer: api`, `Tag: @smoke`. */
  name: string;
}

/** Chips shown before "+N". */
export const CHIP_CAP = 4;

export function testChips(test: Pick<TestCase, 'tags' | 'dimensions'>, dimensions: readonly Pick<DimensionDefinition, 'name'>[], context: FilterContext): TestChip[] {
  const chips: TestChip[] = [];
  for (const { name } of dimensions) {
    for (const value of new Set(test.dimensions[name] ?? [])) chips.push({ facet: dimensionFacet(name), value, label: value, name: `${name}: ${value}` });
  }
  const tags = [...new Set(facetTags(test.tags, context))].sort((a, b) => a.localeCompare(b));
  for (const tag of tags) chips.push({ facet: 'tag', value: tag, label: tag, name: `Tag: ${tag}` });
  return chips;
}

// The report is static: each test's chips are computed once, at first use.
const indexes = new WeakMap<object, ReadonlyMap<string, readonly TestChip[]>>();

/** The chips of every test of a report, by test id; computed once per report. */
export function reportChips(report: Pick<LoupeReport, 'tests' | 'dimensions'>): ReadonlyMap<string, readonly TestChip[]> {
  let index = indexes.get(report);
  if (!index) {
    // Chips need the tag prefixes only, not the failure points.
    const context = filterContext({ dimensions: report.dimensions });
    // Repeats of a test (repeatEach) share its id, its tags and its dimensions.
    index = new Map(report.tests.map((test) => [test.id, testChips(test, report.dimensions, context)]));
    indexes.set(report, index);
  }
  return index;
}

/**
 * The chips of a collapsed row: every active chip, then the first inactive
 * ones up to `cap` chips in all, in their original order. `hidden` counts
 * the chips left out: the "+N" of the row, 0 when every chip is shown.
 */
export function collapsedChips<T>(chips: readonly T[], isActive: (chip: T) => boolean, cap: number = CHIP_CAP): { shown: T[]; hidden: number } {
  if (chips.length <= cap) return { shown: [...chips], hidden: 0 };
  let free = cap - chips.filter(isActive).length;
  const shown = chips.filter((chip) => {
    if (isActive(chip)) return true;
    free -= 1;
    return free >= 0;
  });
  return { shown, hidden: chips.length - shown.length };
}

/** Whether the chip's value is in the active filter. */
export function isChipActive(state: FilterState, chip: Pick<TestChip, 'facet' | 'value'>): boolean {
  return state.facets[chip.facet]?.includes(chip.value) ?? false;
}

/** The filter state a chip links to: its value added to its facet, or removed when active; the search, other facets and the sort kept. */
export function chipFilters(state: FilterState, chip: Pick<TestChip, 'facet' | 'value'>): FilterState {
  return withFacetValue(state, chip.facet, chip.value, !isChipActive(state, chip));
}
