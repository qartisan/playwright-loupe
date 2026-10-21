import { OUTCOMES, type DimensionDefinition, type LoupeReport, type TestCase } from '../../schema/v1.js';
import { splitPrefixedTag } from '../../shared/tags.js';
import { NO_CATEGORY, isFailingAttempt } from '../dashboard.js';
import { failurePoints } from '../failure-points/points.js';
import { skipReason } from '../skip.js';
import { activeFacets, dimensionFacet, facetDimension, type FacetId, type FilterDomain, type FilterState } from './url.js';

/**
 * Which tests match a filter state, and how many tests each facet value would
 * give. Semantics: OR between the values of one facet, AND across facets; the
 * search matches every word, as a substring, ignoring case and accents, in the
 * title path, the file path, the project name, every raw tag (`@layer:api`
 * included, though the tag facet leaves it to the Layer dimension) and the
 * dimension values (annotation-based ones included), and the skip reason
 * of a skipped test (its text only, not the "Skipped" / "Not run" label).
 *
 * Each tag is filterable in one place only: a tag whose prefix is that of a
 * tag dimension (`@layer:ui` with a `layer` dimension) is filtered through
 * the dimension facet (`ui`), never through the tag facet. Otherwise the
 * same tag could be selected twice and AND two facets into nothing.
 *
 * Pure functions, no DOM: unit-tested in Node.
 */

/**
 * What matching needs to know about the report: the tag prefixes taken by
 * dimensions, and the common failure points of each test (see
 * failure-points/points.ts).
 */
export interface FilterContext {
  dimensionTagPrefixes: ReadonlySet<string>;
  failurePoints: ReadonlyMap<TestCase, readonly string[]>;
}

/** No dimension: every tag is in the tag facet. No failure point. */
export const NO_FILTER_CONTEXT: FilterContext = { dimensionTagPrefixes: new Set(), failurePoints: new Map() };

export function filterContext(report: { dimensions: readonly DimensionDefinition[]; tests?: readonly TestCase[] }): FilterContext {
  return {
    dimensionTagPrefixes: new Set(report.dimensions.filter((dimension) => dimension.source === 'tag').map((dimension) => dimension.key)),
    failurePoints: report.tests ? failurePoints({ tests: report.tests }).byTest : new Map(),
  };
}

/** The tags of the tag facet: unprefixed tags, and prefixed tags no dimension takes. The raw tags are unchanged. */
export function facetTags(tags: readonly string[], context: FilterContext): string[] {
  if (context.dimensionTagPrefixes.size === 0) return [...tags];
  return tags.filter((tag) => {
    const parts = splitPrefixedTag(tag);
    return parts === null || !context.dimensionTagPrefixes.has(parts.prefix);
  });
}

/** Lowercase, accents removed: `Élève` → `eleve`. */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** The search words, folded; empty when the search is blank. */
export function searchWords(q: string): string[] {
  return foldText(q).split(/\s+/).filter((word) => word !== '');
}

/**
 * Categories of a test: those of every error of its failing attempts, the
 * same definition as the category counts of the dashboard (a test can have
 * several). Empty for a test that never failed.
 */
export function testCategories(test: TestCase): string[] {
  const categories = new Set<string>();
  for (const attempt of test.attempts) {
    if (!isFailingAttempt(test, attempt)) continue;
    for (const error of attempt.errors) categories.add(error.category ?? NO_CATEGORY);
  }
  return [...categories];
}

interface Derived {
  haystack: string;
  categories: string[];
}

// Tests are immutable once loaded: their derived data is computed once.
const derivedCache = new WeakMap<TestCase, Derived>();

function derived(test: TestCase): Derived {
  let entry = derivedCache.get(test);
  if (!entry) {
    entry = {
      haystack: foldText(
        [
          [...test.suitePath, test.title].join(' › '),
          test.file,
          test.project,
          ...test.tags,
          ...Object.values(test.dimensions).flat(),
          skipReason(test)?.text ?? '',
        ].join('\n'),
      ),
      categories: testCategories(test),
    };
    derivedCache.set(test, entry);
  }
  return entry;
}

/** `testCategories`, computed once per test. */
export function categoriesOf(test: TestCase): readonly string[] {
  return derived(test).categories;
}

/**
 * The category shown for a test: `test.category` (first error of the last
 * failing attempt), then the other categories of its failing attempts.
 * Empty for a test that never failed.
 */
export function shownCategories(test: TestCase): { primary: string | null; others: string[] } {
  const all = categoriesOf(test);
  const primary = test.category !== null && all.includes(test.category) ? test.category : (all[0] ?? null);
  return { primary, others: all.filter((category) => category !== primary) };
}

/** The values a test has for a facet. */
export function testFacetValues(test: TestCase, facet: FacetId, context: FilterContext = NO_FILTER_CONTEXT): readonly string[] {
  switch (facet) {
    case 'status':
      return [test.outcome];
    case 'project':
      return [test.project];
    case 'tag':
      return facetTags(test.tags, context);
    case 'category':
      return categoriesOf(test);
    case 'point':
      return context.failurePoints.get(test) ?? [];
    default:
      return test.dimensions[facetDimension(facet) ?? ''] ?? [];
  }
}

function matchesSearch(test: TestCase, words: readonly string[]): boolean {
  if (words.length === 0) return true;
  const { haystack } = derived(test);
  return words.every((word) => haystack.includes(word));
}

function matchesFacet(test: TestCase, facet: FacetId, selected: readonly string[], context: FilterContext): boolean {
  if (selected.length === 0) return true;
  const values = testFacetValues(test, facet, context);
  return selected.some((value) => values.includes(value));
}

export function matchTest(test: TestCase, state: FilterState, context: FilterContext = NO_FILTER_CONTEXT): boolean {
  if (!matchesSearch(test, searchWords(state.q))) return false;
  return activeFacets(state.facets).every(([facet, selected]) => matchesFacet(test, facet, selected, context));
}

export function filterTests(tests: readonly TestCase[], state: FilterState, context: FilterContext = NO_FILTER_CONTEXT): TestCase[] {
  const words = searchWords(state.q);
  const facets = activeFacets(state.facets);
  return tests.filter((test) => matchesSearch(test, words) && facets.every(([facet, selected]) => matchesFacet(test, facet, selected, context)));
}

/**
 * For each facet of `domain`, the number of tests per value, counted with
 * every other active filter applied but not the facet's own selection: the
 * number of tests that selecting (or adding) this value would show.
 */
export function facetCounts(
  tests: readonly TestCase[],
  state: FilterState,
  domain: FilterDomain,
  context: FilterContext = NO_FILTER_CONTEXT,
): Map<FacetId, Map<string, number>> {
  const counts = new Map<FacetId, Map<string, number>>();
  for (const [facet, values] of domain) counts.set(facet, new Map([...values].map((value) => [value, 0])));
  const words = searchWords(state.q);
  const active = activeFacets(state.facets);

  const add = (test: TestCase, facet: FacetId): void => {
    const facetCounts = counts.get(facet);
    if (!facetCounts) return;
    for (const value of new Set(testFacetValues(test, facet, context))) {
      const count = facetCounts.get(value);
      if (count !== undefined) facetCounts.set(value, count + 1);
    }
  };

  for (const test of tests) {
    if (!matchesSearch(test, words)) continue;
    // The one active facet this test fails, if exactly one: it counts for that facet only.
    let failing: FacetId | null = null;
    let failures = 0;
    for (const [facet, selected] of active) {
      if (matchesFacet(test, facet, selected, context)) continue;
      failures += 1;
      failing = facet;
      if (failures > 1) break;
    }
    if (failures > 1) continue;
    if (failing !== null) add(test, failing);
    else for (const facet of domain.keys()) add(test, facet);
  }
  return counts;
}

/**
 * The values each facet can take in a report. Facets come in display order:
 * status, error category, failure point, project, tag, then dimensions in
 * report order (configured ones in config order, then automatic ones by
 * name). Values come in display order too: statuses by severity, categories
 * in rule order, failure points as ranked on the Overview (only the shown
 * ones), projects in report order, tags sorted, dimension values as the dimension
 * declares them, then sorted. Values
 * no test has are left out, and so are facets without values: the tag facet
 * is hidden when every tag belongs to a dimension. Projects without a name
 * cannot be written in the URL and are left out.
 */
export function filterDomain(report: Pick<LoupeReport, 'projects' | 'tests' | 'dimensions' | 'categories'>): Map<FacetId, Set<string>> {
  const context = filterContext(report);
  const present = (facet: FacetId): Set<string> => new Set(report.tests.flatMap((test) => testFacetValues(test, facet, context)));
  const ordered = (order: readonly string[], values: Set<string>): Set<string> =>
    new Set([...order.filter((value) => values.has(value)), ...[...values].filter((value) => !order.includes(value)).sort((a, b) => a.localeCompare(b))]);

  const domain = new Map<FacetId, Set<string>>();
  const set = (facet: FacetId, values: Set<string>): void => {
    if (values.size > 0) domain.set(facet, values);
  };
  set('status', ordered(['failed', 'flaky', ...OUTCOMES.filter((outcome) => outcome !== 'failed' && outcome !== 'flaky')], present('status')));
  set('category', ordered(report.categories.map((category) => category.name), present('category')));
  set('point', new Set(failurePoints(report).points.map((point) => point.key)));
  const projects = present('project');
  projects.delete('');
  set('project', ordered(report.projects.map((project) => project.name), projects));
  set('tag', ordered([], present('tag')));
  for (const dimension of report.dimensions) {
    const facet = dimensionFacet(dimension.name);
    set(facet, ordered(dimension.values ?? [], present(facet)));
  }
  return domain;
}
