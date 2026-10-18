import { describe, expect, it } from 'vitest';
import { attemptMedia, fileHref } from '../src/renderer/detail/media.js';
import type { Attachment, ComparisonRole } from '../src/schema/v1.js';

function file(name: string, contentType: string, fields: Partial<Attachment> = {}): Attachment {
  const kind = contentType.startsWith('image/') ? 'screenshot' : contentType.startsWith('video/') ? 'video' : name === 'trace' ? 'trace' : 'text';
  return { name, contentType, kind, path: `data/t/0/${name}`, body: null, comparison: null, ...fields };
}

function compared(group: string, role: ComparisonRole): Attachment {
  return file(`${group.replace('.png', '')}-${role}.png`, 'image/png', { comparison: { group, role } });
}

describe('attemptMedia', () => {
  it('sorts attachments by viewer, keeping their order', () => {
    const shot = file('screenshot', 'image/png');
    const video = file('video', 'video/webm');
    const trace = file('trace', 'application/zip');
    const context = file('error-context', 'text/markdown');
    const other = file('dump', 'application/octet-stream', { kind: 'other' });
    const second = file('after-click', 'image/png');
    expect(attemptMedia([shot, video, trace, context, other, second])).toEqual({
      comparisons: [],
      screenshots: [shot, second],
      videos: [video],
      traces: [trace],
      files: [context, other],
    });
  });

  it('groups comparison images by group, out of the thumbnails', () => {
    const expected = compared('square.png', 'expected');
    const actual = compared('square.png', 'actual');
    const diff = compared('square.png', 'diff');
    const loose = file('screenshot', 'image/png');
    const media = attemptMedia([expected, loose, actual, diff]);
    expect(media.comparisons).toEqual([{ group: 'square.png', images: { expected, actual, diff } }]);
    expect(media.screenshots).toEqual([loose]);
  });

  it('keeps one comparison per group, in order of first appearance', () => {
    const [a, b] = [compared('a.png', 'expected'), compared('b.png', 'expected')];
    const media = attemptMedia([b, a, compared('a.png', 'actual'), compared('b.png', 'actual')]);
    expect(media.comparisons.map((set) => set.group)).toEqual(['b.png', 'a.png']);
  });

  it('shows a group with a single image as a normal screenshot', () => {
    // A first run without a baseline attaches the actual image only.
    const actual = compared('fresh.png', 'actual');
    expect(attemptMedia([actual])).toMatchObject({ comparisons: [], screenshots: [actual] });
  });

  it('keeps a second image with the same role as a loose screenshot', () => {
    const [actual, again, expected] = [compared('x.png', 'actual'), compared('x.png', 'actual'), compared('x.png', 'expected')];
    const media = attemptMedia([actual, again, expected]);
    expect(media.comparisons).toEqual([{ group: 'x.png', images: { actual, expected } }]);
    expect(media.screenshots).toEqual([again]);
  });
});

describe('fileHref', () => {
  it('encodes each path segment, keeping the slashes', () => {
    expect(fileHref('data/ab12/0/screenshot.png')).toBe('data/ab12/0/screenshot.png');
    expect(fileHref('data/ab12/0/my shot #1.png')).toBe('data/ab12/0/my%20shot%20%231.png');
  });
});
