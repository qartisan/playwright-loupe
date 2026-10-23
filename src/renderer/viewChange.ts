import type { TestCase } from '../schema/v1.js';
import type { Route } from './router.js';

/**
 * What a route change means for focus and the page title. A page is a route
 * without its query: a view, a test, an error group, a category of the errors
 * view. The query holds state inside a page (filters, search, sort, attempt,
 * steps), so changing it is never a page change.
 *
 * Pure functions, no DOM: unit-tested in Node.
 */

/** Identity of the page a route shows. */
export function pageKey(route: Route): string {
  switch (route.page) {
    case 'errors':
      return route.category === undefined ? 'errors' : `errors/category/${route.category}`;
    case 'test':
      return `test/${route.id}/${route.repeatEachIndex}`;
    case 'group':
      return `group/${route.signature}`;
    case 'not-found':
      return `not-found/${route.path}`;
    default:
      return route.page;
  }
}

/**
 * Whether going from `previous` to `next` shows another page, so focus moves
 * to its heading. Never on the first load (`previous` null).
 */
export function isPageChange(previous: Route | null, next: Route): boolean {
  return previous !== null && pageKey(previous) !== pageKey(next);
}

/** Where focus is when a route change is rendered: facts read from the DOM by the caller. */
export interface FocusContext {
  /** Focus is in the sidebar tree: the change came from it (a row opened, or Back / Forward from there). */
  inTree: boolean;
  /** The sidebar is an overlay, closed once a page is chosen. */
  narrow: boolean;
  /** The errors view, opened on a category, has focused that category. */
  categoryFocused: boolean;
}

/**
 * Whether focus moves to the new page's heading. Only on a page change, and
 * not when focus is already where the user continues: the sidebar tree, which
 * stays visible on wide screens so its rows can be browsed with the keyboard,
 * or the category the errors view was opened on.
 */
export function focusesHeading(previous: Route | null, next: Route, context: FocusContext): boolean {
  if (!isPageChange(previous, next)) return false;
  if (context.inTree && !context.narrow) return false;
  return !context.categoryFocused;
}

const VIEW_NAMES = { dashboard: 'Overview', errors: 'Errors', health: 'Suite health', tests: 'Tests', group: 'Error group', 'not-found': 'Not found' } as const;

/**
 * `<page> · <suite name>`: the view name, the test title on a test detail,
 * the category name on a category, "Error group" on a group page. Without a
 * suite name, `<page> · Loupe`.
 */
export function pageTitle(route: Route, tests: readonly Pick<TestCase, 'id' | 'repeatEachIndex' | 'title'>[], suiteName: string): string {
  const suite = suiteName.trim() || 'Loupe';
  let page: string;
  if (route.page === 'test') {
    const test = tests.find((candidate) => candidate.id === route.id && candidate.repeatEachIndex === route.repeatEachIndex);
    page = test ? `${test.title}${route.repeatEachIndex > 0 ? ` (repeat ${route.repeatEachIndex})` : ''}` : VIEW_NAMES['not-found'];
  } else if (route.page === 'errors' && route.category !== undefined) {
    page = route.category;
  } else {
    page = VIEW_NAMES[route.page];
  }
  return `${page} · ${suite}`;
}
