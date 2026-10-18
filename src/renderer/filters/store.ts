import { computed, signal } from '@preact/signals';
import type { LoupeReport } from '../../schema/v1.js';
import { currentLocation, setLocation, setSearchNormalizer } from '../navigation.js';
import { formatHash, type Route } from '../router.js';
import { joinQuery, parseDetailParams, serializeDetailParams } from '../detail/params.js';
import { NO_FILTER_CONTEXT, filterContext, filterDomain, type FilterContext } from './match.js';
import { parseFilters, serializeFilters, type FilterDomain, type FilterState } from './url.js';

/**
 * The one filter state of the report, read from the URL query. Components
 * read `filters`; changes go through `setFilters`, which writes the URL.
 */

export const domain = signal<FilterDomain>(new Map());

/** The tag prefixes taken by dimensions, for matching and counting. */
export const context = signal<FilterContext>(NO_FILTER_CONTEXT);

/**
 * Takes the facet values from the report and normalizes the current URL
 * against them: a value outside them, such as a tag a dimension takes, is
 * dropped.
 */
export function initFilters(report: Pick<LoupeReport, 'projects' | 'tests' | 'dimensions' | 'categories'>): void {
  domain.value = filterDomain(report);
  context.value = filterContext(report);
  setSearchNormalizer((search, route) => joinQuery(serializeFilters(parseFilters(search, domain.value)), detailQuery(search, route)));
}

/** The test detail's own parameters (attempt, steps), kept on the test route only. */
function detailQuery(search: string, route: Route): string {
  return route.page === 'test' ? serializeDetailParams(parseDetailParams(search)) : '';
}

export const filters = computed<FilterState>(() => parseFilters(currentLocation.value.search, domain.value));

/** Link to a route with this filter state. */
export function filtersHref(state: FilterState, route: Route = currentLocation.value.route): string {
  return formatHash({ route, search: serializeFilters(state) });
}

/**
 * Applies a filter state. `push` for a discrete change (a checkbox, a chip,
 * a sort), so Back undoes it; `replace` for typing in the search field.
 */
export function setFilters(state: FilterState, mode: 'push' | 'replace' = 'push', route: Route = currentLocation.value.route): void {
  // The test detail keeps its attempt and steps view while the filters change (typing a search).
  const current = currentLocation.value;
  const detail = formatHash({ route, search: '' }) === formatHash({ route: current.route, search: '' }) ? detailQuery(current.search, route) : '';
  setLocation({ route, search: joinQuery(serializeFilters(state), detail) }, mode);
}

/** Replaces the test detail's parameters, keeping the filters. */
export function setDetailQuery(query: string, mode: 'push' | 'replace' = 'replace'): void {
  const { route, search } = currentLocation.value;
  setLocation({ route, search: joinQuery(serializeFilters(parseFilters(search, domain.value)), query) }, mode);
}
