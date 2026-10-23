import { signal } from '@preact/signals';
import { announce } from './announce.js';

/**
 * Copy to the clipboard, with a fallback: some browsers restrict the
 * Clipboard API on file://. When it is missing or refuses, a dialog shows the
 * text selected, for the viewer to copy by hand.
 */

/** What the fallback dialog shows; null when it is closed. */
export const copyFallback = signal<{ label: string; text: string } | null>(null);

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator.clipboard?.writeText !== 'function') return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copies `text`; `label` names it in messages ("Rerun command"). Resolves
 * true when copied, false when the fallback dialog was opened instead.
 */
export async function copyText(label: string, text: string): Promise<boolean> {
  if (await writeClipboard(text)) {
    announce(`${label} copied to the clipboard.`);
    return true;
  }
  copyFallback.value = { label, text };
  return false;
}
