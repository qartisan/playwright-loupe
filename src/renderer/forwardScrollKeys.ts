import { scrollMove } from './scrollKeys.js';

/**
 * Forwards scroll keys to the element `target` returns. Listens on `window`,
 * after the document's own handlers (shortcuts, viewers), so a key they took
 * is left alone. Instant under `prefers-reduced-motion` and for held keys,
 * smooth otherwise. Returns the cleanup.
 */
export function forwardScrollKeys(target: () => HTMLElement | null): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    const element = target();
    if (!element) return;
    const active = document.activeElement;
    const move = scrollMove(event, {
      focusOnBody: active === null || active === document.body,
      dialogOpen: document.querySelector('dialog[open]') !== null,
      pageHeight: element.clientHeight,
    });
    if (!move) return;
    event.preventDefault();
    const behavior: ScrollBehavior = event.repeat || window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
    if ('to' in move) element.scrollTo({ top: move.to === 'start' ? 0 : element.scrollHeight, behavior });
    else element.scrollBy({ ...move.by, behavior });
  };
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}
