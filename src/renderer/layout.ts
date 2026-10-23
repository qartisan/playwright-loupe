import { signal } from '@preact/signals';
import { readPreference, writePreference } from './storage.js';

const SIDEBAR_KEY = 'loupe.sidebar';

/** Below this width the sidebar overlays the main area and starts closed. */
const NARROW = '(max-width: 760px)';

export function isNarrow(): boolean {
  return window.matchMedia(NARROW).matches;
}

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

export function toggleSidebar(): void {
  sidebarOpen.value = !sidebarOpen.value;
  if (!isNarrow()) writePreference(SIDEBAR_KEY, sidebarOpen.value ? 'open' : 'closed');
}

/** A request to show a tree group (a project card was clicked); `seq` makes repeated requests distinct. */
export const revealRequest = signal<{ key: string; seq: number } | null>(null);

/** Opens the sidebar, expands the group with this tree key, scrolls to it and focuses it. */
export function revealInSidebar(key: string): void {
  sidebarOpen.value = true;
  revealRequest.value = { key, seq: (revealRequest.value?.seq ?? 0) + 1 };
}
