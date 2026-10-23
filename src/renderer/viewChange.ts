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

/**
 * Where a route change started: `sidebar` for a view link, a tree row or
 * another link of the sidebar; `other` for the content, the shortcuts
 * (j / k on a test or an error group, o / e / h / t), Back / Forward and
 * typed URLs.
 */
export type NavigationOrigin = 'sidebar' | 'other';

/** Facts about a route change, gathered by the caller. */
export interface ChangeContext {
  origin: NavigationOrigin;
  /** The sidebar is an overlay, closed once a page is chosen. */
  narrow: boolean;
  /** The errors view, opened on a category, has focused that category. */
  categoryFocused: boolean;
}

/** A change started in the sidebar, which stays visible: focus stays where it is, in the sidebar. */
function staysInSidebar(context: ChangeContext): boolean {
  return context.origin === 'sidebar' && !context.narrow;
}

/**
 * Whether focus moves to the new page's heading. Only on a page change, and
 * not when focus is already where the user continues: in the sidebar, when
 * the change started there and it stays visible (its links and tree can
 * still be browsed), or on the category the errors view was opened on.
 */
export function focusesHeading(previous: Route | null, next: Route, context: ChangeContext): boolean {
  if (!isPageChange(previous, next) || staysInSidebar(context)) return false;
  return !context.categoryFocused;
}

/**
 * Whether the new page's name is announced in the live region: on a page
 * change started in the sidebar, where focus stays and nothing else tells
 * a screen reader that the page changed. Never when focus moves.
 */
export function announcesPage(previous: Route | null, next: Route, context: ChangeContext): boolean {
  return isPageChange(previous, next) && staysInSidebar(context);
}

const VIEW_NAMES = { dashboard: 'Overview', errors: 'Errors', health: 'Suite health', tests: 'Tests', group: 'Error group', 'not-found': 'Not found' } as const;

type TitledTest = Pick<TestCase, 'id' | 'repeatEachIndex' | 'title'>;

/** The name of a page: the view name, the test title on a test detail, the category name on a category, "Error group" on a group page. */
export function pageName(route: Route, tests: readonly TitledTest[]): string {
  if (route.page === 'test') {
    const test = tests.find((candidate) => candidate.id === route.id && candidate.repeatEachIndex === route.repeatEachIndex);
    return test ? `${test.title}${route.repeatEachIndex > 0 ? ` (repeat ${route.repeatEachIndex})` : ''}` : VIEW_NAMES['not-found'];
  }
  if (route.page === 'errors' && route.category !== undefined) return route.category;
  return VIEW_NAMES[route.page];
}

/** `<page> · <suite name>`, or `<page> · Loupe` without a suite name. */
export function pageTitle(route: Route, tests: readonly TitledTest[], suiteName: string): string {
  return `${pageName(route, tests)} · ${suiteName.trim() || 'Loupe'}`;
}
