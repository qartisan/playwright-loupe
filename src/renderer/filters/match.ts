import { OUTCOMES, type LoupeReport, type TestCase } from '../../schema/v1.js';
import { NO_CATEGORY, isFailingAttempt } from '../dashboard.js';
import { activeFacets, dimensionFacet, facetDimension, type FacetId, type FilterDomain, type FilterState } from './url.js';

/**
 * Which tests match a filter state, and how many tests each facet value would
 * give. Semantics: OR between the values of one facet, AND across facets; the
 * search matches every word, as a substring, ignoring case and accents, in the
 * title path, the file path and the project name.
 *
 * Pure functions, no DOM: unit-tested in Node.
 */

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
      haystack: foldText([[...test.suitePath, test.title].join(' › '), test.file, test.project].join('\n')),
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
export function testFacetValues(test: TestCase, facet: FacetId): readonly string[] {
  switch (facet) {
    case 'status':
      return [test.outcome];
    case 'project':
      return [test.project];
    case 'tag':
      return test.tags;
    case 'category':
      return categoriesOf(test);
    default:
      return test.dimensions[facetDimension(facet) ?? ''] ?? [];
  }
}

function matchesSearch(test: TestCase, words: readonly string[]): boolean {
  if (words.length === 0) return true;
  const { haystack } = derived(test);
  return words.every((word) => haystack.includes(word));
}

function matchesFacet(test: TestCase, facet: FacetId, selected: readonly string[]): boolean {
  if (selected.length === 0) return true;
  const values = testFacetValues(test, facet);
  return selected.some((value) => values.includes(value));
}

export function matchTest(test: TestCase, state: FilterState): boolean {
  if (!matchesSearch(test, searchWords(state.q))) return false;
  return activeFacets(state.facets).every(([facet, selected]) => matchesFacet(test, facet, selected));
}

export function filterTests(tests: readonly TestCase[], state: FilterState): TestCase[] {
  const words = searchWords(state.q);
  const facets = activeFacets(state.facets);
  return tests.filter((test) => matchesSearch(test, words) && facets.every(([facet, selected]) => matchesFacet(test, facet, selected)));
}

/**
 * For each facet of `domain`, the number of tests per value, counted with
 * every other active filter applied but not the facet's own selection: the
 * number of tests that selecting (or adding) this value would show.
 */
export function facetCounts(tests: readonly TestCase[], state: FilterState, domain: FilterDomain): Map<FacetId, Map<string, number>> {
  const counts = new Map<FacetId, Map<string, number>>();
  for (const [facet, values] of domain) counts.set(facet, new Map([...values].map((value) => [value, 0])));
  const words = searchWords(state.q);
  const active = activeFacets(state.facets);

  const add = (test: TestCase, facet: FacetId): void => {
    const facetCounts = counts.get(facet);
    if (!facetCounts) return;
    for (const value of new Set(testFacetValues(test, facet))) {
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
      if (matchesFacet(test, facet, selected)) continue;
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
 * The values each facet can take in a report, in display order: statuses in
 * severity order, projects in report order, tags sorted, dimension values as
 * the dimension declares them then sorted, categories in rule order. Values
 * no test has are left out, and so are facets without values. Projects
 * without a name cannot be written in the URL and are left out.
 */
export function filterDomain(report: Pick<LoupeReport, 'projects' | 'tests' | 'dimensions' | 'categories'>): Map<FacetId, Set<string>> {
  const present = (facet: FacetId): Set<string> => new Set(report.tests.flatMap((test) => testFacetValues(test, facet)));
  const ordered = (order: readonly string[], values: Set<string>): Set<string> =>
    new Set([...order.filter((value) => values.has(value)), ...[...values].filter((value) => !order.includes(value)).sort((a, b) => a.localeCompare(b))]);

  const domain = new Map<FacetId, Set<string>>();
  const set = (facet: FacetId, values: Set<string>): void => {
    if (values.size > 0) domain.set(facet, values);
  };
  set('status', ordered(['failed', 'flaky', ...OUTCOMES.filter((outcome) => outcome !== 'failed' && outcome !== 'flaky')], present('status')));
  const projects = present('project');
  projects.delete('');
  set('project', ordered(report.projects.map((project) => project.name), projects));
  set('tag', ordered([], present('tag')));
  for (const dimension of report.dimensions) {
    const facet = dimensionFacet(dimension.name);
    set(facet, ordered(dimension.values ?? [], present(facet)));
  }
  set('category', ordered(report.categories.map((category) => category.name), present('category')));
  return domain;
}
