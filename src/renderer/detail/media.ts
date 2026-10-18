import type { Attachment, ComparisonRole } from '../../schema/v1.js';

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

/** A relative link to a file of the report folder, each segment encoded: works from file://. */
export function fileHref(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}
