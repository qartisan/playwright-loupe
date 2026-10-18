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

/** A relative link to a file of the report folder, each segment encoded: works from file://. */
export function fileHref(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}
