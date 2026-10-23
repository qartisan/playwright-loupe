import type { ComponentChildren } from 'preact';
import { useId, useLayoutEffect, useRef } from 'preact/hooks';
import { copyFallback } from '../clipboard.js';
import { SHORTCUTS, setSingleKeyShortcuts, singleKeyShortcuts } from '../shortcuts.js';
import { CloseIcon } from './icons.js';

/**
 * A modal dialog on the native `<dialog>`: the rest of the page is inert
 * while it is open, so focus stays inside; Escape closes it; focus returns to
 * where it was when it opened. A click on the backdrop closes it too.
 * `actions` go in the header, before the close button.
 */
export function Dialog({
  open,
  onClose,
  title,
  class: className,
  actions,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  class?: string;
  actions?: ComponentChildren;
  children: ComponentChildren;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const id = useId();

  // On every render, not only when `open` changes: the element can close (Escape) before the state that says so is rendered.
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      element.showModal();
    } else if (!open && element.open) {
      element.close();
    }
  });

  return (
    <dialog
      ref={dialog}
      class={`dialog ${className ?? ''}`}
      aria-labelledby={id}
      onClose={() => {
        // The close event is queued: the dialog may have been opened again since (Escape, then Enter at once).
        if (dialog.current?.open) return;
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
        <div class="dialog-actions">
          {actions}
          <button type="button" class="icon-button" title="Close" onClick={() => dialog.current?.close()}>
            <CloseIcon />
            <span class="visually-hidden">Close</span>
          </button>
        </div>
      </div>
      {children}
    </dialog>
  );
}

/** A label inside a sentence: "Rerun command" becomes "rerun command", an acronym stays ("AI prompt"). */
function inSentence(label: string): string {
  return /^[A-Z]{2}/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1);
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
    <Dialog open={current !== null} onClose={() => (copyFallback.value = null)} title={`Copy ${inSentence(current?.label ?? '')}`} class="copy-dialog">
      <p class="dialog-note">
        The browser did not allow copying from this page. The text is selected: press Ctrl+C (⌘C on macOS) to copy it.
      </p>
      <textarea ref={area} class="copy-text" readOnly rows={8} aria-label={current?.label ?? ''} value={current?.text ?? ''} spellcheck={false} />
    </Dialog>
  );
}

/** The keys turned off with the single-key shortcuts: "j, k, o, e, h, t, / and ?". */
const SINGLE_KEYS = ((keys: string[]) => `${keys.slice(0, -1).join(', ')} and ${keys[keys.length - 1]}`)(
  SHORTCUTS.filter((shortcut) => shortcut.singleKey).flatMap((shortcut) => shortcut.keys),
);

/**
 * Every keyboard shortcut, as documented in the README, and the switch for
 * single-key shortcuts (WCAG 2.1.4): on by default, remembered when storage
 * works.
 */
export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" class="shortcuts-dialog">
      <label class="shortcut-switch">
        <input type="checkbox" checked={singleKeyShortcuts.value} onChange={(event) => setSingleKeyShortcuts(event.currentTarget.checked)} />
        Single-key shortcuts
      </label>
      <p class="dialog-note">
        {SINGLE_KEYS}. Turn them off if they get in the way of your keyboard or assistive technology; Escape and the arrow keys keep working.
      </p>
      <table class="shortcuts-table">
        <caption class="visually-hidden">Keyboard shortcuts</caption>
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
