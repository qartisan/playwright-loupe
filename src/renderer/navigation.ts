import { signal } from '@preact/signals';
import { formatHash, parseHash, type AppLocation, type Route } from './router.js';

/** The current location, parsed from the URL fragment and kept in sync with it. */
export const currentLocation = signal<AppLocation>(parseHash(window.location.hash));

window.addEventListener('hashchange', () => {
  currentLocation.value = parseHash(window.location.hash);
});

/** Link to a route, keeping the current query (view state such as filters). */
export function hrefTo(route: Route): string {
  return formatHash({ route, query: currentLocation.value.query });
}

export function navigate(route: Route): void {
  window.location.hash = hrefTo(route);
}
