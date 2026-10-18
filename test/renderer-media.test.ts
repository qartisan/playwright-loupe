import { describe, expect, it } from 'vitest';
import {
  absoluteFilePath,
  attemptMedia,
  comparisonModes,
  fileHref,
  pickMode,
  traceCommand,
  traceHelp,
  viewerItems,
  type ComparisonSet,
} from '../src/renderer/detail/media.js';
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

function set(...roles: ComparisonRole[]): ComparisonSet {
  return { group: 'g.png', images: Object.fromEntries(roles.map((role) => [role, compared('g.png', role)])) };
}

describe('viewerItems', () => {
  it('lists comparisons first, then the loose screenshots', () => {
    const loose = file('screenshot', 'image/png');
    const media = attemptMedia([loose, compared('a.png', 'expected'), compared('a.png', 'actual')]);
    expect(viewerItems(media).map((item) => (item.type === 'image' ? item.attachment.name : item.set.group))).toEqual(['a.png', 'screenshot']);
  });
});

describe('comparisonModes', () => {
  it('offers only the modes the images allow', () => {
    expect(comparisonModes(set('expected', 'actual', 'diff'))).toEqual(['diff', 'side', 'slider', 'overlay']);
    expect(comparisonModes(set('expected', 'actual'))).toEqual(['side', 'slider', 'overlay']);
    expect(comparisonModes(set('actual', 'diff'))).toEqual(['diff']);
    expect(comparisonModes(set('expected', 'diff'))).toEqual(['diff']);
  });
});

describe('pickMode', () => {
  it('defaults to Diff when there is a diff image, else Side by side', () => {
    expect(pickMode(['diff', 'side', 'slider', 'overlay'], null)).toBe('diff');
    expect(pickMode(['side', 'slider', 'overlay'], null)).toBe('side');
  });

  it('keeps the mode chosen in the session when the images allow it', () => {
    expect(pickMode(['diff', 'side', 'slider', 'overlay'], 'overlay')).toBe('overlay');
    expect(pickMode(['side', 'slider', 'overlay'], 'slider')).toBe('slider');
    expect(pickMode(['side', 'slider', 'overlay'], 'diff')).toBe('side');
    expect(pickMode(['diff'], 'slider')).toBe('diff');
  });
});

describe('absoluteFilePath', () => {
  const page = 'file:///home/gilles/Dev/app/loupe-report/index.html#/test/ab12?attempt=1';

  it('resolves a report file against the page location over file://', () => {
    expect(absoluteFilePath('data/ab12/0/trace.zip', page)).toBe('/home/gilles/Dev/app/loupe-report/data/ab12/0/trace.zip');
  });

  it('decodes spaces and accented characters, percent-encoded in the page URL', () => {
    expect(absoluteFilePath('data/ab12/0/my trace.zip', 'file:///home/gilles/Mes%20Documents/r%C3%A9sultats/index.html')).toBe(
      '/home/gilles/Mes Documents/résultats/data/ab12/0/my trace.zip',
    );
  });

  it('keeps a #, ? or % in a file name as part of the path', () => {
    expect(absoluteFilePath('data/ab12/0/trace #1?.zip', page)).toBe('/home/gilles/Dev/app/loupe-report/data/ab12/0/trace #1?.zip');
    expect(absoluteFilePath('data/ab12/0/100%.zip', page)).toBe('/home/gilles/Dev/app/loupe-report/data/ab12/0/100%.zip');
  });

  it('drops the leading slash of a Windows drive path', () => {
    expect(absoluteFilePath('data/ab12/0/trace.zip', 'file:///C:/Users/Gilles/loupe-report/index.html')).toBe('C:/Users/Gilles/loupe-report/data/ab12/0/trace.zip');
  });

  it('is unknown for a file:// URL with a host, and over http(s)', () => {
    expect(absoluteFilePath('data/ab12/0/trace.zip', 'file://server/share/loupe-report/index.html')).toBeNull();
    expect(absoluteFilePath('data/ab12/0/trace.zip', 'http://localhost:5173/#/test/ab12')).toBeNull();
    expect(absoluteFilePath('data/ab12/0/trace.zip', 'https://reports.example.com/run/index.html')).toBeNull();
  });

  it('is unknown when the page URL has a malformed escape', () => {
    expect(absoluteFilePath('data/ab12/0/trace.zip', 'file:///home/gilles/bad%E9/index.html')).toBeNull();
  });
});

describe('traceCommand', () => {
  const page = 'file:///home/gilles/Dev/app/loupe-report/index.html';

  it('opens the trace by its absolute path over file://, quoted for a POSIX shell when needed', () => {
    expect(traceCommand('data/ab12/0/trace.zip', page)).toBe('npx playwright show-trace /home/gilles/Dev/app/loupe-report/data/ab12/0/trace.zip');
    expect(traceCommand('data/ab12/0/trace.zip', 'file:///home/gilles/Mes%20Documents/r%C3%A9sultats/index.html')).toBe(
      "npx playwright show-trace '/home/gilles/Mes Documents/résultats/data/ab12/0/trace.zip'",
    );
    expect(traceCommand('data/ab12/0/trace.zip', "file:///home/gilles/Bob's%20app/report/index.html")).toBe(
      "npx playwright show-trace '/home/gilles/Bob'\\''s app/report/data/ab12/0/trace.zip'",
    );
    expect(traceCommand("data/ab12/0/it's.zip", page)).toBe("npx playwright show-trace '/home/gilles/Dev/app/loupe-report/data/ab12/0/it'\\''s.zip'");
    expect(traceCommand('data/ab12/0/trace.zip', 'file:///C:/Users/Gilles/report/index.html')).toBe('npx playwright show-trace C:/Users/Gilles/report/data/ab12/0/trace.zip');
  });

  it('keeps the path relative to the report folder when the disk path is unknown', () => {
    expect(traceCommand('data/ab12/0/trace.zip', 'http://localhost:5173/')).toBe('npx playwright show-trace data/ab12/0/trace.zip');
    expect(traceCommand('data/ab12/0/my trace.zip', 'https://reports.example.com/index.html')).toBe("npx playwright show-trace 'data/ab12/0/my trace.zip'");
    expect(traceCommand("data/ab12/0/it's.zip", 'file://server/share/index.html')).toBe("npx playwright show-trace 'data/ab12/0/it'\\''s.zip'");
  });
});

describe('traceHelp', () => {
  it("names the run's Playwright version as the minimum, when known", () => {
    expect(traceHelp('1.64.0', false)).toBe(
      "Requires Playwright 1.64.0 or later. Run it from the report folder (the one containing index.html), in a POSIX shell (bash, zsh); it uses the project's own Playwright.",
    );
    expect(traceHelp('', false)).toBe("Run it from the report folder (the one containing index.html), in a POSIX shell (bash, zsh); it uses the project's own Playwright.");
    expect(traceHelp('  ', false)).not.toContain('Requires');
  });

  it('says to run it from the project root when the path is absolute', () => {
    expect(traceHelp('1.64.0', true)).toBe(
      "Requires Playwright 1.64.0 or later. Run it from your project root, in a POSIX shell (bash, zsh), so it uses the project's own Playwright.",
    );
    expect(traceHelp('', true)).toBe("Run it from your project root, in a POSIX shell (bash, zsh), so it uses the project's own Playwright.");
  });
});

describe('fileHref', () => {
  it('encodes each path segment, keeping the slashes', () => {
    expect(fileHref('data/ab12/0/screenshot.png')).toBe('data/ab12/0/screenshot.png');
    expect(fileHref('data/ab12/0/my shot #1.png')).toBe('data/ab12/0/my%20shot%20%231.png');
  });
});
