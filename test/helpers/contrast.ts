import type { Locator } from '@playwright/test';
import { contrast } from '../../src/shared/color.js';

/** Every text color of `scope` against the background it is drawn on, as hex pairs, for a contrast check. */
export async function textContrasts(scope: Locator): Promise<Array<{ text: string; ratio: number }>> {
  const pairs = await scope.evaluate((root) => {
    const view = root.ownerDocument.defaultView as NonNullable<typeof root.ownerDocument.defaultView>;
    const hex = (color: string): string | null => {
      const parts = color.match(/[\d.]+/g)?.map(Number);
      if (!parts || (parts.length > 3 && parts[3] === 0)) return null;
      return `#${parts.slice(0, 3).map((part) => Math.round(part).toString(16).padStart(2, '0')).join('')}`;
    };
    const background = (element: typeof root.parentElement): string => {
      for (let current = element; current; current = current.parentElement) {
        const color = hex(view.getComputedStyle(current).backgroundColor);
        if (color) return color;
      }
      return '#ffffff';
    };
    const result: Array<{ text: string; fg: string; bg: string }> = [];
    const walker = root.ownerDocument.createTreeWalker(root, view.NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const element = node.parentElement;
      if (!element || (node.textContent ?? '').trim() === '' || element.closest('.visually-hidden, [hidden]')) continue;
      const fg = hex(view.getComputedStyle(element).color);
      if (fg) result.push({ text: (node.textContent ?? '').trim(), fg, bg: background(element) });
    }
    return result;
  });
  return pairs.map(({ text, fg, bg }) => ({ text, ratio: contrast(fg, bg) }));
}
