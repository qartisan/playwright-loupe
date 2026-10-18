import type { Attachment, ComparisonRole } from '../../schema/v1.js';
import { shellQuote } from './rerun.js';

/**
 * The attachments of an attempt, sorted for the media viewers: screenshot
 * comparisons, loose screenshots, videos, traces and other files. Pure
 * functions, no DOM: unit-tested in Node.
 */

/** The images of one `toHaveScreenshot` / `toMatchSnapshot` group, by role. */
export interface ComparisonSet {
  group: string;
  images: Partial<Record<ComparisonRole, Attachment>>;
}

export interface AttemptMedia {
  /** Groups with at least two images, in order of first appearance. */
  comparisons: ComparisonSet[];
  /** Screenshots outside a comparison, a group with a single image included. */
  screenshots: Attachment[];
  videos: Attachment[];
  traces: Attachment[];
  /** Text and other attachments, listed as before. */
  files: Attachment[];
}

/** What the viewer shows, in the order of the test detail: comparisons first, then screenshots. */
export type ViewerItem = { type: 'image'; attachment: Attachment } | { type: 'comparison'; set: ComparisonSet };

export const COMPARISON_MODES = ['diff', 'side', 'slider', 'overlay'] as const;
export type ComparisonMode = (typeof COMPARISON_MODES)[number];

export const MODE_LABELS: Record<ComparisonMode, string> = { diff: 'Diff', side: 'Side by side', slider: 'Slider', overlay: 'Overlay' };

export function attemptMedia(attachments: readonly Attachment[]): AttemptMedia {
  const sets = new Map<string, ComparisonSet>();
  // The first image of each role in a group; another image with the same role stays a loose screenshot.
  for (const attachment of attachments) {
    if (attachment.kind !== 'screenshot' || !attachment.comparison) continue;
    const { group, role } = attachment.comparison;
    let set = sets.get(group);
    if (!set) sets.set(group, (set = { group, images: {} }));
    if (set.images[role]) continue;
    set.images[role] = attachment;
  }
  const comparisons = [...sets.values()].filter((set) => Object.keys(set.images).length > 1);
  const inComparison = new Set(comparisons.flatMap((set) => Object.values(set.images)));
  const media: AttemptMedia = { comparisons, screenshots: [], videos: [], traces: [], files: [] };
  for (const attachment of attachments) {
    if (inComparison.has(attachment)) continue;
    if (attachment.kind === 'screenshot') media.screenshots.push(attachment);
    else if (attachment.kind === 'video') media.videos.push(attachment);
    else if (attachment.kind === 'trace') media.traces.push(attachment);
    else media.files.push(attachment);
  }
  return media;
}

export function viewerItems(media: AttemptMedia): ViewerItem[] {
  return [
    ...media.comparisons.map((set): ViewerItem => ({ type: 'comparison', set })),
    ...media.screenshots.map((attachment): ViewerItem => ({ type: 'image', attachment })),
  ];
}

/** The modes the images allow: Diff needs the diff image, the others both the expected and the actual image. */
export function comparisonModes(set: ComparisonSet): ComparisonMode[] {
  const { expected, actual, diff } = set.images;
  return COMPARISON_MODES.filter((mode) => (mode === 'diff' ? diff !== undefined : expected !== undefined && actual !== undefined));
}

/**
 * The mode a comparison shows: the one chosen last in this session when
 * these images allow it, else Diff when there is a diff image, else Side by side.
 */
export function pickMode(modes: readonly ComparisonMode[], chosen: ComparisonMode | null): ComparisonMode {
  if (chosen !== null && modes.includes(chosen)) return chosen;
  return modes.includes('diff') ? 'diff' : (modes[0] ?? 'side');
}

/**
 * The absolute disk path of a report file, from the URL of the page showing
 * the report: only known over file://. Null over http(s) (the dev server, a
 * future `show` command) and for a file:// URL with a host (a UNC share),
 * where the disk path cannot be told. A Windows drive path loses the leading
 * `/` of its URL form (`/C:/Users/…` → `C:/Users/…`).
 */
export function absoluteFilePath(path: string, pageUrl: string): string | null {
  let url: URL;
  try {
    // Each segment encoded, so a `#`, `?` or `%` in a file name stays part of the path.
    url = new URL(fileHref(path), pageUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'file:' || url.host !== '') return null;
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  return /^\/[A-Za-z]:(?:\/|$)/.test(pathname) ? pathname.slice(1) : pathname;
}

/**
 * Opens a trace in Playwright's trace viewer, for a POSIX shell: the trace
 * viewer needs an HTTP server, so it cannot run from file://. Over file://
 * the trace has an absolute path and the command works from any directory;
 * otherwise the path stays relative to the report folder.
 */
export function traceCommand(path: string, pageUrl: string): string {
  return `npx playwright show-trace ${shellQuote(absoluteFilePath(path, pageUrl) ?? path)}`;
}

/**
 * Help of the trace command. An older trace viewer shows an empty screen on a
 * newer trace, without an error: the run's Playwright version is the minimum.
 * Left out when the report has no version. With an absolute path, the command
 * runs from the project root, like the rerun commands, so it uses the
 * project's Playwright; with a relative one, from the report folder.
 */
export function traceHelp(playwrightVersion: string, absolute: boolean): string {
  const version = playwrightVersion.trim();
  const requires = version === '' ? '' : `Requires Playwright ${version} or later. `;
  if (absolute) return `${requires}Run it from your project root, in a POSIX shell (bash, zsh), so it uses the project's own Playwright.`;
  return `${requires}Run it from the report folder (the one containing index.html), in a POSIX shell (bash, zsh); it uses the project's own Playwright.`;
}

/** A relative link to a file of the report folder, each segment encoded: works from file://. */
export function fileHref(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}
