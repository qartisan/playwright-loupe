import { computed, signal } from '@preact/signals';
import type { LoupeReport } from '../../schema/v1.js';
import { currentLocation, setLocation, setSearchNormalizer } from '../navigation.js';
import { formatHash, type Route } from '../router.js';
import { filterDomain } from './match.js';
import { parseFilters, serializeFilters, type FilterDomain, type FilterState } from './url.js';

/**
 * The one filter state of the report, read from the URL query. Components
 * read `filters`; changes go through `setFilters`, which writes the URL.
 */

export const domain = signal<FilterDomain>(new Map());

/** Takes the facet values from the report and normalizes the current URL against them. */
export function initFilters(report: Pick<LoupeReport, 'projects' | 'tests' | 'dimensions' | 'categories'>): void {
  domain.value = filterDomain(report);
  setSearchNormalizer((search) => serializeFilters(parseFilters(search, domain.value)));
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
  setLocation({ route, search: serializeFilters(state) }, mode);
}
