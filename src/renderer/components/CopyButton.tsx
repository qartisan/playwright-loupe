import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { copyText } from '../clipboard.js';
import { CheckIcon, CopyIcon } from './icons.js';

/** How long the button says "Copied". */
const CONFIRMATION_MS = 2000;

/**
 * Copies a text built on click. Success is shown on the button and announced
 * to screen readers; when the Clipboard API is unavailable, the fallback
 * dialog opens. `help` describes the button (tooltip and accessible
 * description).
 */
export function CopyButton({
  label,
  text,
  help,
  children,
}: {
  /** What is copied, for messages: "Rerun command". */
  label: string;
  text: () => string;
  help?: string | undefined;
  children: ComponentChildren;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const helpId = useId();
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <>
      <button
        type="button"
        class="button copy-button"
        title={help}
        aria-describedby={help ? helpId : undefined}
        onClick={async () => {
          if (!(await copyText(label, text()))) return;
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), CONFIRMATION_MS);
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
        <span>{children}</span>
        {/* Hidden from assistive technologies: the live region announces the copy, and a change of the focused button's name would be read too. */}
        {copied && <span class="copy-done" aria-hidden="true"> · Copied</span>}
      </button>
      {help && (
        <span id={helpId} hidden>
          {help}
        </span>
      )}
    </>
  );
}
