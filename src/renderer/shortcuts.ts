import { useLayoutEffect, useRef } from 'preact/hooks';

/**
 * Single-key keyboard shortcuts. They never fire while focus is in a text
 * field, with Ctrl, Alt or Meta held, or while a modal dialog is open.
 */

export interface ShortcutHelp {
  keys: readonly string[];
  action: string;
  where: string;
}

/** Every shortcut of the report, for the shortcuts dialog (and the README). */
export const SHORTCUTS: readonly ShortcutHelp[] = [
  { keys: ['j', 'k'], action: 'Next / previous test', where: 'Test detail' },
  { keys: ['[', ']'], action: 'Previous / next attempt', where: 'Test detail' },
  { keys: ['n', 'p'], action: 'Next / previous error group', where: 'Error group page' },
  { keys: ['/'], action: 'Focus the search', where: 'Everywhere' },
  { keys: ['Escape'], action: 'Clear the search, close a dialog', where: 'Everywhere' },
  { keys: ['?'], action: 'Show keyboard shortcuts', where: 'Everywhere' },
];

/** Text fields keep single keys for themselves. */
export function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(target.type);
}

/** Whether a key press may trigger a single-key shortcut. Shift is allowed: `?` needs it on most layouts. */
export function shortcutAllowed(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return false;
  if (isTextField(event.target)) return false;
  return document.querySelector('dialog[open]') === null;
}

/** Binds keys (`event.key` values) to actions while the calling component is mounted. */
export function useShortcuts(actions: Readonly<Record<string, (() => void) | null>>): void {
  const current = useRef(actions);
  current.current = actions;
  // A layout effect: listening as soon as the page shows, not after the first paint.
  useLayoutEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!shortcutAllowed(event)) return;
      const action = current.current[event.key];
      if (!action) return;
      event.preventDefault();
      action();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}
