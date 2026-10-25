import { computed, signal } from '@preact/signals';
import { readPreference, writePreference } from './storage.js';

const SIDEBAR_KEY = 'loupe.sidebar';

/** Below this width the sidebar overlays the main area and starts closed. */
const NARROW = '(max-width: 760px)';

export function isNarrow(): boolean {
  return window.matchMedia(NARROW).matches;
}

/** Whether the screen is narrow, following resizes and zoom: what renders depends on it. */
const narrowQuery = window.matchMedia(NARROW);
const narrow = signal(narrowQuery.matches);
narrowQuery.addEventListener('change', (event) => (narrow.value = event.matches));

/**
 * At most this height (400 % zoom), the page scrolls as a whole and the
 * header scrolls away with the content; above it, the content scrolls in
 * `<main>` under a fixed header. Same query as in styles.css.
 */
const SHORT = '(max-height: 480px)';

export function pageScrolls(): boolean {
  return window.matchMedia(SHORT).matches;
}

/** Sidebar visibility; remembered on wide screens only. */
export const sidebarOpen = signal(!isNarrow() && readPreference(SIDEBAR_KEY) !== 'closed');

/** The narrow sidebar is open over the content: the content is inert behind it, under a backdrop. */
export const overlayOpen = computed(() => narrow.value && sidebarOpen.value);

/** The header's sidebar toggle, where focus returns when Escape closes the narrow sidebar. */
export const SIDEBAR_TOGGLE_ID = 'sidebar-toggle';

export function toggleSidebar(): void {
  sidebarOpen.value = !sidebarOpen.value;
  if (!isNarrow()) writePreference(SIDEBAR_KEY, sidebarOpen.value ? 'open' : 'closed');
}

/**
 * Closes the narrow sidebar; nothing when it is docked (wide screens) or
 * closed, and the remembered preference is never written. Returns whether
 * focus was inside it, for the caller to decide where focus goes: the new
 * page's heading after a page change, the toggle after Escape.
 */
export function closeNarrowSidebar(): boolean {
  if (!overlayOpen.value) return false;
  const focusInside = document.getElementById('sidebar')?.contains(document.activeElement) === true;
  sidebarOpen.value = false;
  // The content stops being inert now, not at the next render: the caller may move focus into it in the same event.
  const main = document.querySelector<HTMLElement>('main');
  if (main) main.inert = false;
  return focusInside;
}

/**
 * Escape closes the narrow sidebar, as the last thing to close: an event
 * already handled (the search field clearing its text, a tooltip hiding)
 * and an open dialog take it first. Focus inside the sidebar returns to the
 * toggle; anywhere else, it stays.
 */
export function closeNarrowSidebarOnEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open]')) return;
  if (closeNarrowSidebar()) document.getElementById(SIDEBAR_TOGGLE_ID)?.focus();
}

/** A request to show a tree group (a project card was clicked); `seq` makes repeated requests distinct. */
export const revealRequest = signal<{ key: string; seq: number } | null>(null);

/** Opens the sidebar, expands the group with this tree key, scrolls to it and focuses it. */
export function revealInSidebar(key: string): void {
  sidebarOpen.value = true;
  revealRequest.value = { key, seq: (revealRequest.value?.seq ?? 0) + 1 };
}
