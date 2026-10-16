import { signal } from '@preact/signals';
import { readPreference, writePreference } from './storage.js';

const SIDEBAR_KEY = 'loupe.sidebar';

/** Below this width the sidebar overlays the main area and starts closed. */
const NARROW = '(max-width: 760px)';

export function isNarrow(): boolean {
  return window.matchMedia(NARROW).matches;
}

/** Sidebar visibility; remembered on wide screens only. */
export const sidebarOpen = signal(!isNarrow() && readPreference(SIDEBAR_KEY) !== 'closed');

export function toggleSidebar(): void {
  sidebarOpen.value = !sidebarOpen.value;
  if (!isNarrow()) writePreference(SIDEBAR_KEY, sidebarOpen.value ? 'open' : 'closed');
}
