import type { AllowEntry } from './helpers/axe.js';

/**
 * Accepted axe-core findings of the accessibility matrix
 * (renderer-a11y-browser.test.ts). Each entry names one rule on the elements
 * matching a selector, with the reason it is accepted. Never a whole rule:
 * a new element breaking the same rule still fails. An entry that matches
 * nothing in a full run fails the run, so fixed findings leave this list.
 */
export const A11Y_ALLOWLIST: readonly AllowEntry[] = [
  {
    rule: 'scrollable-region-focusable',
    selector: 'pre.code-snippet',
    reason:
      'Known violation (WCAG 2.1.1), found in the brief 11 audit: an error snippet wider than its card scrolls but cannot be focused, so it cannot be scrolled with the keyboard. Fixed next by making the snippet focusable; remove this entry with the fix.',
  },
  {
    rule: 'video-caption',
    selector: '.video video',
    reason:
      'Silent test recordings produced by Playwright, no audio track: there is nothing to caption (WCAG 1.2.2 covers synchronized media with audio). axe cannot tell and reports it as needing review.',
  },
];
