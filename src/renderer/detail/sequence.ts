import type { TestCase } from '../../schema/v1.js';
import type { ErrorGroup } from '../dashboard.js';
import { rankGroups } from '../dashboard.js';
import { filterTests, type FilterContext } from '../filters/match.js';
import { sortTests, type SortRanks } from '../filters/sort.js';
import type { FilterState } from '../filters/url.js';

/**
 * Previous / next navigation: between tests (the Tests view's list, filtered
 * and sorted, without its render cap) and between error groups (the Errors
 * view's order, optionally restricted to categories).
 *
 * Pure functions, no DOM: unit-tested in Node.
 */

export interface Neighbors<T> {
  /** 1-based position; null when the item is not in the list. */
  position: number | null;
  total: number;
  previous: T | null;
  next: T | null;
}

/** Where `item` is in `list` and what comes before and after it; no wrap-around at the ends. */
export function neighbors<T>(list: readonly T[], item: T): Neighbors<T> {
  const index = list.indexOf(item);
  if (index === -1) return { position: null, total: list.length, previous: null, next: null };
  return { position: index + 1, total: list.length, previous: list[index - 1] ?? null, next: list[index + 1] ?? null };
}

/** The tests of the Tests view, in its order: filtered, sorted, every row (no render cap). */
export function testSequence(tests: readonly TestCase[], state: FilterState, context: FilterContext, ranks: SortRanks): TestCase[] {
  return sortTests(filterTests(tests, state, context), state.sort, ranks);
}

/**
 * Error groups in the Errors view's order (most failed tests, then most
 * flaky). With categories, only the groups of those categories, same order.
 */
export function groupSequence(groups: readonly ErrorGroup[], categories: readonly string[] = []): ErrorGroup[] {
  const ranked = rankGroups(groups);
  return categories.length === 0 ? ranked : ranked.filter((group) => categories.includes(group.category));
}

/**
 * The sequence a group page walks through: restricted to the category
 * filter when the group belongs to it (a link from a category), the global
 * one otherwise.
 */
export function groupNavigation(groups: readonly ErrorGroup[], group: ErrorGroup, categories: readonly string[]): Neighbors<ErrorGroup> & { restricted: boolean } {
  const restricted = categories.length > 0 && categories.includes(group.category);
  return { ...neighbors(groupSequence(groups, restricted ? categories : []), group), restricted };
}
