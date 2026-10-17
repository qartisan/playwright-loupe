/**
 * Filter state and its URL form. The state lives in the query of the hash
 * fragment (works from file://):
 *
 *   #/tests?q=login&status=failed,flaky&project=chromium&tag=@smoke&dim.Layer=api,ui&category=Network&sort=duration:desc
 *
 * Each value is encoded with encodeURIComponent, then values are joined with
 * commas: a comma inside a value is `%2C` and never splits it. The form is
 * canonical: fixed parameter order, sorted values, empty parameters and the
 * default sort left out, so two equal states give the same URL.
 *
 * Pure functions, no DOM: unit-tested in Node.
 */

export const SORT_COLUMNS = ['status', 'title', 'project', 'file', 'duration', 'category', 'attempts'] as const;
export type SortColumn = (typeof SORT_COLUMNS)[number];
export type SortDirection = 'asc' | 'desc';

export interface Sort {
  column: SortColumn;
  direction: SortDirection;
}

/** Status severity (failed, flaky, passed, skipped), then title. */
export const DEFAULT_SORT: Sort = { column: 'status', direction: 'asc' };

/** A multi-value facet: status, project, tag, category, or a dimension (`dim.<name>`). */
export type FacetId = 'status' | 'project' | 'tag' | 'category' | `dim.${string}`;

/** Selected values per facet. A facet without values does not filter. */
export type FacetSelection = Readonly<Partial<Record<FacetId, readonly string[]>>>;

export interface FilterState {
  /** Free text; empty when not filtering. */
  q: string;
  facets: FacetSelection;
  sort: Sort;
}

/** The facets with at least one selected value, in URL order. */
export function activeFacets(selection: FacetSelection): Array<[FacetId, readonly string[]]> {
  return facetOrder(Object.keys(selection) as FacetId[])
    .map((facet): [FacetId, readonly string[]] => [facet, selection[facet] ?? []])
    .filter(([, values]) => values.length > 0);
}

export const EMPTY_FILTERS: FilterState = { q: '', facets: {}, sort: DEFAULT_SORT };

/** The values each facet accepts; values and facets outside it are dropped when parsing. */
export type FilterDomain = ReadonlyMap<FacetId, ReadonlySet<string>>;

const FIXED_FACETS = ['status', 'project', 'tag'] as const;
const DIMENSION_PREFIX = 'dim.';

export function dimensionFacet(name: string): FacetId {
  return `${DIMENSION_PREFIX}${name}`;
}

/** The dimension name of a `dim.<name>` facet; null for the other facets. */
export function facetDimension(facet: FacetId): string | null {
  return facet.startsWith(DIMENSION_PREFIX) ? facet.slice(DIMENSION_PREFIX.length) : null;
}

function compareCodePoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Facets in URL order: status, project, tag, dimensions by name, category. */
export function facetOrder(facets: Iterable<FacetId>): FacetId[] {
  const rank = (facet: FacetId): number => (facet === 'category' ? 4 : facetDimension(facet) !== null ? 3 : FIXED_FACETS.indexOf(facet as never));
  return [...facets].sort((a, b) => rank(a) - rank(b) || compareCodePoints(a, b));
}

function decode(text: string): string | null {
  try {
    // `+` is a space in form-encoded queries; encodeURIComponent writes a real `+` as `%2B`.
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    return null;
  }
}

function parseSort(value: string): Sort | null {
  const [column, direction, ...rest] = value.split(':');
  if (rest.length > 0 || !(SORT_COLUMNS as readonly string[]).includes(column ?? '')) return null;
  if (direction !== 'asc' && direction !== 'desc') return null;
  return { column: column as SortColumn, direction };
}

/**
 * Reads the filter state from a raw query (`a=b&c=d`, with or without a
 * leading `?`) or from a whole fragment (`#/tests?a=b`). Unknown parameters,
 * malformed values and values outside `domain` are dropped; without a domain,
 * every value is kept.
 */
export function parseFilters(input: string, domain?: FilterDomain): FilterState {
  let search = input;
  if (input.startsWith('#')) {
    const queryStart = input.indexOf('?');
    search = queryStart === -1 ? '' : input.slice(queryStart + 1);
  } else if (input.startsWith('?')) {
    search = input.slice(1);
  }
  const facets: Partial<Record<FacetId, string[]>> = {};
  let q = '';
  let sort = DEFAULT_SORT;

  for (const pair of search.split('&')) {
    if (pair === '') continue;
    const equals = pair.indexOf('=');
    const key = decode(equals === -1 ? pair : pair.slice(0, equals));
    const raw = equals === -1 ? '' : pair.slice(equals + 1);
    if (key === null) continue;
    if (key === 'q') {
      q = decode(raw) ?? '';
      continue;
    }
    if (key === 'sort') {
      sort = parseSort(decode(raw) ?? '') ?? sort;
      continue;
    }
    const isFacet = (FIXED_FACETS as readonly string[]).includes(key) || key === 'category' || (key.startsWith(DIMENSION_PREFIX) && key.length > DIMENSION_PREFIX.length);
    if (!isFacet) continue;
    const facet = key as FacetId;
    const allowed = domain?.get(facet);
    if (domain && !allowed) continue;
    for (const part of raw.split(',')) {
      const value = decode(part);
      if (value === null || value === '' || (allowed && !allowed.has(value))) continue;
      (facets[facet] ??= []).push(value);
    }
  }
  return normalizeFilters({ q, facets, sort });
}

/** Sorted, deduplicated values; facets without values removed. */
export function normalizeFilters(state: FilterState): FilterState {
  const facets: Partial<Record<FacetId, string[]>> = {};
  for (const [facet, selected] of activeFacets(state.facets)) facets[facet] = [...new Set(selected)].sort(compareCodePoints);
  return { q: state.q, facets, sort: state.sort };
}

function isDefaultSort(sort: Sort): boolean {
  return sort.column === DEFAULT_SORT.column && sort.direction === DEFAULT_SORT.direction;
}

/** The canonical query, without `?`; empty for the empty state with the default sort. */
export function serializeFilters(state: FilterState): string {
  const normalized = normalizeFilters(state);
  const parts: string[] = [];
  const q = normalized.q.trim();
  if (q !== '') parts.push(`q=${encodeURIComponent(q)}`);
  for (const [facet, values] of activeFacets(normalized.facets)) {
    parts.push(`${encodeURIComponent(facet)}=${values.map(encodeURIComponent).join(',')}`);
  }
  if (!isDefaultSort(normalized.sort)) parts.push(`sort=${normalized.sort.column}:${normalized.sort.direction}`);
  return parts.join('&');
}

/** Number of active filters: the search counts as one, then one per selected value. */
export function activeFilterCount(state: FilterState): number {
  return (state.q.trim() !== '' ? 1 : 0) + activeFacets(state.facets).reduce((sum, [, values]) => sum + values.length, 0);
}

export function withFacetValue(state: FilterState, facet: FacetId, value: string, selected: boolean): FilterState {
  const current = state.facets[facet] ?? [];
  const values = selected ? [...current, value] : current.filter((other) => other !== value);
  return { ...state, facets: { ...state.facets, [facet]: values } };
}

/** No search and no facet value; the sort is kept. */
export function clearFilters(state: FilterState): FilterState {
  return { ...EMPTY_FILTERS, sort: state.sort };
}
