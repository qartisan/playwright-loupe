import type { ComponentChildren } from 'preact';
import { useId, useLayoutEffect, useRef } from 'preact/hooks';
import { copyFallback } from '../clipboard.js';
import { SHORTCUTS } from '../shortcuts.js';
import { CloseIcon } from './icons.js';

/**
 * A modal dialog on the native `<dialog>`: the rest of the page is inert
 * while it is open, so focus stays inside; Escape closes it; focus returns to
 * where it was when it opened. A click on the backdrop closes it too.
 */
export function Dialog({
  open,
  onClose,
  title,
  class: className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  class?: string;
  children: ComponentChildren;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const id = useId();

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      element.showModal();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialog}
      class={`dialog ${className ?? ''}`}
      aria-labelledby={id}
      onClose={() => {
        onClose();
        // The close event comes after the dialog closed: focus returns to the opener unless something else took it since.
        const active = document.activeElement;
        if (!active || active === document.body || dialog.current?.contains(active)) opener.current?.focus();
        opener.current = null;
      }}
      onClick={(event) => {
        if (event.target === dialog.current) dialog.current?.close();
      }}
    >
      <div class="dialog-head">
        <h2 id={id}>{title}</h2>
        <button type="button" class="icon-button" title="Close" onClick={() => dialog.current?.close()}>
          <CloseIcon />
          <span class="visually-hidden">Close</span>
        </button>
      </div>
      {children}
    </dialog>
  );
}

/** Shown when the Clipboard API is unavailable: the text, selected, to copy by hand. */
export function CopyFallbackDialog() {
  const current = copyFallback.value;
  const area = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (!current) return;
    area.current?.focus();
    area.current?.select();
  }, [current]);
  return (
    <Dialog open={current !== null} onClose={() => (copyFallback.value = null)} title={`Copy ${current?.label.toLowerCase() ?? ''}`} class="copy-dialog">
      <p class="dialog-note">
        The browser did not allow copying from this page. The text is selected: press Ctrl+C (⌘C on macOS) to copy it.
      </p>
      <textarea ref={area} class="copy-text" readOnly rows={8} aria-label={current?.label ?? ''} value={current?.text ?? ''} spellcheck={false} />
    </Dialog>
  );
}

/** Every keyboard shortcut, as documented in the README. */
export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" class="shortcuts-dialog">
      <table class="shortcuts-table">
        <thead>
          <tr>
            <th scope="col">Key</th>
            <th scope="col">Action</th>
            <th scope="col">Where</th>
          </tr>
        </thead>
        <tbody>
          {SHORTCUTS.map(({ keys, action, where }) => (
            <tr key={action}>
              <td>
                {keys.map((key, index) => (
                  <span key={key}>
                    {index > 0 && ' / '}
                    <kbd>{key}</kbd>
                  </span>
                ))}
              </td>
              <td>{action}</td>
              <td>{where}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p class="dialog-note">Single keys do nothing while typing in a field or with Ctrl, Alt or Meta held.</p>
    </Dialog>
  );
}
