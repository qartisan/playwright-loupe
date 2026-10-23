/**
 * Scroll keys while nothing has focus. The content scrolls inside `<main>`,
 * not the document: while focus is on `<body>` (right after load, or after a
 * click outside a focusable element), the browser scrolls nothing. Page Up /
 * Page Down, Space and Shift+Space, Home / End and the arrow keys are then
 * forwarded to `<main>` (the listener: forwardScrollKeys.ts). Focus never
 * moves. Nothing happens when focus is in an element (a control, a field,
 * the tree), when a dialog is open, with a modifier (except Shift for
 * Space), or when a handler already took the key.
 *
 * Pure functions, no DOM: unit-tested in Node.
 */

/** The parts of a keydown event that decide. */
export interface ScrollKeyEvent {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  defaultPrevented: boolean;
  isComposing: boolean;
}

export interface ScrollKeyContext {
  /** Focus is on `<body>`, or nowhere. */
  focusOnBody: boolean;
  dialogOpen: boolean;
  /** Visible height of the scrolling element, in pixels. */
  pageHeight: number;
}

/** A relative move in pixels, or a jump to the start or the end. */
export type ScrollMove = { by: { top: number; left: number } } | { to: 'start' | 'end' };

/** One arrow key press, as in browsers. */
export const LINE_STEP = 40;

/** One page: most of the visible height, so a line of context stays, as in browsers. */
export function pageStep(pageHeight: number): number {
  return Math.max(LINE_STEP, Math.round(pageHeight * 0.875));
}

/** The move a key asks for, or null when the key is not forwarded. Pure: unit-tested in Node. */
export function scrollMove(event: ScrollKeyEvent, context: ScrollKeyContext): ScrollMove | null {
  if (!context.focusOnBody || context.dialogOpen || event.defaultPrevented || event.isComposing) return null;
  if (event.ctrlKey || event.altKey || event.metaKey) return null;
  const page = pageStep(context.pageHeight);
  if (event.key === ' ') return { by: { top: event.shiftKey ? -page : page, left: 0 } };
  if (event.shiftKey) return null;
  switch (event.key) {
    case 'PageDown':
      return { by: { top: page, left: 0 } };
    case 'PageUp':
      return { by: { top: -page, left: 0 } };
    case 'ArrowDown':
      return { by: { top: LINE_STEP, left: 0 } };
    case 'ArrowUp':
      return { by: { top: -LINE_STEP, left: 0 } };
    case 'ArrowRight':
      return { by: { top: 0, left: LINE_STEP } };
    case 'ArrowLeft':
      return { by: { top: 0, left: -LINE_STEP } };
    case 'Home':
      return { to: 'start' };
    case 'End':
      return { to: 'end' };
    default:
      return null;
  }
}
