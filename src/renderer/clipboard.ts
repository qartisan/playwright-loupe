import { signal } from '@preact/signals';

/**
 * Copy to the clipboard, with a fallback: some browsers restrict the
 * Clipboard API on file://. When it is missing or refuses, a dialog shows the
 * text selected, for the viewer to copy by hand.
 */

/** Text announced to screen readers by the app's live region; `seq` makes a repeated message distinct. */
export const announcement = signal<{ text: string; seq: number }>({ text: '', seq: 0 });

export function announce(text: string): void {
  announcement.value = { text, seq: announcement.value.seq + 1 };
}

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
