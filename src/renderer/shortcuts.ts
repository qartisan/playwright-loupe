import { signal } from '@preact/signals';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { shortcutKey } from './shortcutKeys.js';
import { readPreference, writePreference } from './storage.js';

/**
 * Single-key keyboard shortcuts. They never fire while focus is in a text
 * field, with Ctrl, Alt or Meta held (AltGr is Ctrl+Alt on Windows), while a
 * modal dialog is open, or when the viewer turned them off (WCAG 2.1.4).
 */

export interface ShortcutHelp {
  keys: readonly string[];
  action: string;
  where: string;
  /** A key typed alone, turned off with the single-key shortcuts. */
  singleKey: boolean;
}

/** Every shortcut and key of the report, for the shortcuts dialog (and the README). */
export const SHORTCUTS: readonly ShortcutHelp[] = [
  { keys: ['j', 'k'], action: 'Next / previous test, or error group', where: 'Test detail, error group page', singleKey: true },
  { keys: ['o', 'e', 'h', 't'], action: 'Overview, Errors, Suite health, Tests', where: 'Everywhere', singleKey: true },
  { keys: ['/'], action: 'Focus the search', where: 'Everywhere', singleKey: true },
  { keys: ['?'], action: 'Show keyboard shortcuts', where: 'Everywhere', singleKey: true },
  { keys: ['↑', '↓'], action: 'Move between the view links, or the tree rows', where: 'Sidebar', singleKey: false },
  { keys: ['Home', 'End'], action: 'First / last view link or tree row', where: 'Sidebar', singleKey: false },
  { keys: ['Enter', 'Space'], action: 'Open the view or the test, focus stays', where: 'Sidebar', singleKey: false },
  { keys: ['←', '→'], action: 'Collapse / expand a group', where: 'Sidebar tree', singleKey: false },
  { keys: ['←', '→'], action: 'Previous / next screenshot', where: 'Screenshot viewer', singleKey: false },
  { keys: ['Escape'], action: 'Clear the search, close a dialog or the narrow sidebar', where: 'Everywhere', singleKey: false },
];

const SINGLE_KEY_STORAGE = 'loupe.singleKeyShortcuts';

/** Whether single-key shortcuts fire: on unless the viewer turned them off (remembered when storage works). */
export const singleKeyShortcuts = signal(readPreference(SINGLE_KEY_STORAGE) !== 'off');

export function setSingleKeyShortcuts(on: boolean): void {
  singleKeyShortcuts.value = on;
  writePreference(SINGLE_KEY_STORAGE, on ? 'on' : 'off');
}

/** `aria-keyshortcuts` for a single key: only while single-key shortcuts are on. */
export function singleKeyHint(key: string): string | undefined {
  return singleKeyShortcuts.value ? key : undefined;
}

/** Text fields keep single keys for themselves. */
export function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(target.type);
}

/** Whether a key press may trigger a single-key shortcut. Shift is allowed: `?` needs it on most layouts. */
export function shortcutAllowed(event: KeyboardEvent): boolean {
  if (!singleKeyShortcuts.value) return false;
  if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return false;
  if (isTextField(event.target)) return false;
  return document.querySelector('dialog[open]') === null;
}

/** Binds keys (`event.key` values, see shortcutKey) to actions while the calling component is mounted. */
export function useShortcuts(actions: Readonly<Record<string, (() => void) | null>>): void {
  const current = useRef(actions);
  current.current = actions;
  // A layout effect: listening as soon as the page shows, not after the first paint.
  useLayoutEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!shortcutAllowed(event)) return;
      const action = current.current[shortcutKey(event)];
      if (!action) return;
      event.preventDefault();
      action();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}
