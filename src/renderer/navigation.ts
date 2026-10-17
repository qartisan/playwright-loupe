import { signal } from '@preact/signals';
import { formatHash, parseHash, redirectHash, type AppLocation, type Route } from './router.js';

/** Rewrites the query to its canonical form; identity until the filters set one. */
let normalizeSearch = (search: string): string => search;

/**
 * The location of the current fragment, after redirects and query
 * normalization. When either changes the fragment, the history entry is
 * replaced, so Back does not return to the former form.
 */
function readLocation(): AppLocation {
  const hash = window.location.hash;
  const parsed = parseHash(hash);
  const location = { route: parsed.route, search: normalizeSearch(parsed.search) };
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
export function setSearchNormalizer(normalize: (search: string) => string): void {
  normalizeSearch = normalize;
  sync();
}

/** Link to a route, keeping the current query (view state such as filters). */
export function hrefTo(route: Route): string {
  return formatHash({ route, search: currentLocation.value.search });
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
