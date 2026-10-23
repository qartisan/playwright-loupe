import { signal } from '@preact/signals';
import { formatHash, parseHash, redirectHash, type AppLocation, type Route } from './router.js';
import { isPageChange, type NavigationOrigin } from './viewChange.js';

/** Rewrites the query to its canonical form for a route; identity until the filters set one. */
let normalizeSearch = (search: string, _route: Route): string => search;

/**
 * The location of the current fragment, after redirects and query
 * normalization. When either changes the fragment, the history entry is
 * replaced, so Back does not return to the former form.
 */
function readLocation(): AppLocation {
  const hash = window.location.hash;
  const parsed = parseHash(hash);
  const location = { route: parsed.route, search: normalizeSearch(parsed.search, parsed.route) };
  if (redirectHash(hash) !== null || location.search !== parsed.search) {
    window.history.replaceState(window.history.state, '', formatHash(location));
  }
  return location;
}

/** The current location, parsed from the URL fragment and kept in sync with it. */
export const currentLocation = signal<AppLocation>(readLocation());

function sync(): void {
  const location = readLocation();
  if (formatHash(location) !== formatHash(currentLocation.value)) currentLocation.value = location;
}

// Links and typed URLs fire hashchange; Back and Forward across pushState entries fire popstate.
window.addEventListener('hashchange', sync);
window.addEventListener('popstate', sync);

/** Sets the query normalizer and applies it to the current URL. */
export function setSearchNormalizer(normalize: (search: string, route: Route) => string): void {
  normalizeSearch = normalize;
  sync();
}

/** Query parameters that point inside one page (the attempt of a test): never carried to another page. */
const PAGE_PARAMS = new Set(['attempt']);

function withoutPageParams(search: string): string {
  return search
    .split('&')
    .filter((pair) => pair !== '' && !PAGE_PARAMS.has(pair.split('=')[0] ?? ''))
    .join('&');
}

/**
 * Link to a route, keeping the current query (view state such as filters),
 * normalized for that route: parameters of another page are dropped.
 */
export function hrefTo(route: Route): string {
  return formatHash({ route, search: normalizeSearch(withoutPageParams(currentLocation.value.search), route) });
}

export function navigate(route: Route): void {
  window.location.hash = hrefTo(route);
}

/**
 * Moves to a location without a hashchange event: `push` adds a history
 * entry (Back undoes the change), `replace` changes the current one.
 */
export function setLocation(location: AppLocation, mode: 'push' | 'replace'): void {
  const hash = formatHash(location);
  if (hash === formatHash(currentLocation.value)) return;
  if (mode === 'push') window.history.pushState(null, '', hash);
  else window.history.replaceState(window.history.state, '', hash);
  currentLocation.value = location;
}

/**
 * Whether the route change about to happen started in the sidebar. Set when a
 * sidebar link or tree row is activated and its target is another page, so
 * the route change that follows is certain and reads it once
 * (viewChange.ts). An activation that changes no page (the current view's
 * link) sets nothing, so the mark never waits for a later change, such as
 * Back: no timer needed.
 */
let sidebarActivation = false;

/** Marks a sidebar activation that opens `href`, when that is another page. */
export function markSidebarActivation(href: string): void {
  sidebarActivation = isPageChange(currentLocation.value.route, parseHash(href).route);
}

/** Where the route change being rendered started; resets the mark. */
export function takeNavigationOrigin(): NavigationOrigin {
  const origin = sidebarActivation ? 'sidebar' : 'other';
  sidebarActivation = false;
  return origin;
}
