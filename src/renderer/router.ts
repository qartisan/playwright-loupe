/**
 * Hash routing: the report is opened from file://, so the route lives in the
 * URL fragment. The fragment is the single source of navigation state:
 *
 *   #/                          dashboard (also an empty fragment)
 *   #/run-errors                run errors
 *   #/test/<id>                 a test (repeatEachIndex 0)
 *   #/test/<id>/repeat/<n>      a test repeated with --repeat-each
 *
 * followed by an optional `?key=value&...` query, reserved for view state such
 * as filters: it is kept when navigating between pages.
 *
 * Pure functions, no DOM: unit-tested in Node.
 */

export type Route =
  | { page: 'dashboard' }
  | { page: 'run-errors' }
  | { page: 'test'; id: string; repeatEachIndex: number }
  | { page: 'not-found'; path: string };

export type Query = Readonly<Record<string, string>>;

export interface AppLocation {
  route: Route;
  query: Query;
}

const REPEAT_INDEX = /^(0|[1-9]\d*)$/;

function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function parseQuery(search: string): Query {
  const query: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(search)) {
    if (key !== '') query[key] = value;
  }
  return query;
}

function parsePath(path: string): Route {
  const raw = path.split('/').filter((segment) => segment !== '');
  const segments = raw.map(decode);
  if (segments.some((segment) => segment === null)) return { page: 'not-found', path };
  const [first, id, third, index] = segments as string[];

  if (segments.length === 0) return { page: 'dashboard' };
  if (first === 'run-errors' && segments.length === 1) return { page: 'run-errors' };
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
  return { route: parsePath(path), query: parseQuery(search) };
}

function routePath(route: Route): string {
  switch (route.page) {
    case 'dashboard':
      return '/';
    case 'run-errors':
      return '/run-errors';
    case 'test': {
      const base = `/test/${encodeURIComponent(route.id)}`;
      return route.repeatEachIndex === 0 ? base : `${base}/repeat/${route.repeatEachIndex}`;
    }
    case 'not-found':
      return route.path.startsWith('/') ? route.path : `/${route.path}`;
  }
}

/** Serializes a location to a fragment (`#/...`). Query keys are sorted, so a location has one form. */
export function formatHash(location: AppLocation): string {
  const entries = Object.entries(location.query).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const search = new URLSearchParams(entries).toString();
  return `#${routePath(location.route)}${search ? `?${search}` : ''}`;
}
