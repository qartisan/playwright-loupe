/**
 * Hash routing: the report is opened from file://, so the route lives in the
 * URL fragment. The fragment is the single source of navigation state:
 *
 *   #/                          overview (also an empty fragment)
 *   #/errors                    errors: run errors, error groups, categories
 *   #/errors/category/<name>    the errors view, scrolled to a category
 *   #/health                    suite health: dimensions, slow, skipped and flaky tests
 *   #/tests                     tests: the flat, filterable and sortable test list
 *   #/test/<id>                 a test (repeatEachIndex 0)
 *   #/test/<id>/repeat/<n>      a test repeated with --repeat-each
 *   #/group/<signature>         an error group: the tests failing with one error signature
 *
 * followed by an optional `?key=value&...` query holding view state (filters
 * and sort, see filters/url.ts): it is kept when navigating between pages.
 * The query is kept raw, undecoded: filter values are encoded one by one and
 * joined with commas, so it is decoded by the filters module, not here.
 *
 * Former routes redirect: `#/run-errors` → `#/errors`.
 *
 * Pure functions, no DOM: unit-tested in Node.
 */

export type Route =
  | { page: 'dashboard' }
  | { page: 'errors'; category?: string }
  | { page: 'health' }
  | { page: 'tests' }
  | { page: 'test'; id: string; repeatEachIndex: number }
  | { page: 'group'; signature: string }
  | { page: 'not-found'; path: string };

export interface AppLocation {
  route: Route;
  /** Raw query, without the leading `?`; empty when there is none. */
  search: string;
}

const REPEAT_INDEX = /^(0|[1-9]\d*)$/;

/** Former single-segment paths and the route they now lead to. */
const REDIRECTS: Readonly<Record<string, Route>> = { 'run-errors': { page: 'errors' } };

function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function decodeURIComponentSafe(segment: string): string {
  return decode(segment) ?? segment;
}

function parsePath(path: string): Route {
  const raw = path.split('/').filter((segment) => segment !== '');
  const segments = raw.map(decode);
  if (segments.some((segment) => segment === null)) return { page: 'not-found', path };
  const [first, id, third, index] = segments as string[];

  if (segments.length === 0) return { page: 'dashboard' };
  if (segments.length === 1 && (first === 'errors' || first === 'health' || first === 'tests')) return { page: first };
  if (first === 'errors' && id === 'category' && segments.length === 3 && third !== undefined) return { page: 'errors', category: third };
  if (segments.length === 1 && first !== undefined && Object.hasOwn(REDIRECTS, first)) return REDIRECTS[first] as Route;
  if (first === 'group' && id !== undefined && segments.length === 2) return { page: 'group', signature: id };
  if (first === 'test' && id !== undefined) {
    if (segments.length === 2) return { page: 'test', id, repeatEachIndex: 0 };
    if (segments.length === 4 && third === 'repeat' && index !== undefined && REPEAT_INDEX.test(index)) {
      return { page: 'test', id, repeatEachIndex: Number(index) };
    }
  }
  return { page: 'not-found', path };
}

/** Parses a URL fragment, with or without the leading `#`. */
export function parseHash(hash: string): AppLocation {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  const queryStart = fragment.indexOf('?');
  const path = queryStart === -1 ? fragment : fragment.slice(0, queryStart);
  const search = queryStart === -1 ? '' : fragment.slice(queryStart + 1);
  return { route: parsePath(path), search };
}

function routePath(route: Route): string {
  switch (route.page) {
    case 'dashboard':
      return '/';
    case 'errors':
      return route.category === undefined ? '/errors' : `/errors/category/${encodeURIComponent(route.category)}`;
    case 'health':
      return '/health';
    case 'tests':
      return '/tests';
    case 'test': {
      const base = `/test/${encodeURIComponent(route.id)}`;
      return route.repeatEachIndex === 0 ? base : `${base}/repeat/${route.repeatEachIndex}`;
    }
    case 'group':
      return `/group/${encodeURIComponent(route.signature)}`;
    case 'not-found':
      return route.path.startsWith('/') ? route.path : `/${route.path}`;
  }
}

/** Serializes a location to a fragment (`#/...`); the query is written as is. */
export function formatHash(location: AppLocation): string {
  return `#${routePath(location.route)}${location.search ? `?${location.search}` : ''}`;
}

/**
 * The fragment to show instead of `hash` when it uses a former path
 * (`#/run-errors` → `#/errors`), query kept; null when no redirect applies.
 */
export function redirectHash(hash: string): string | null {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  const path = fragment.split('?')[0] ?? '';
  const segments = path.split('/').filter((segment) => segment !== '');
  if (segments.length !== 1 || !Object.hasOwn(REDIRECTS, decodeURIComponentSafe(segments[0] as string))) return null;
  return formatHash(parseHash(hash));
}
