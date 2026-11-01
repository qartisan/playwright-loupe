import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  attachmentKind,
  bodyFileName,
  comparisonOf,
  extensionFor,
  isTextContentType,
  safeFileName,
  uniqueFileName,
} from '../src/core/attachments.js';
import { AttachmentStore } from '../src/core/build.js';
import { createPathRewriter } from '../src/core/paths.js';

describe('attachmentKind', () => {
  it.each([
    ['screenshot', 'image/png', 'screenshot'],
    ['square-diff.png', 'image/png', 'screenshot'],
    ['photo', 'image/jpeg', 'screenshot'],
    ['video', 'video/webm', 'video'],
    ['trace', 'application/zip', 'trace'],
    ['my-trace.zip', 'application/zip', 'trace'],
    ['archive', 'application/zip', 'other'],
    ['error-context', 'text/markdown', 'text'],
    ['log', 'text/plain; charset=utf-8', 'text'],
    ['payload', 'application/json', 'text'],
    ['report', 'application/vnd.api+json', 'text'],
    ['binary', 'application/octet-stream', 'other'],
    ['pdf', 'application/pdf', 'other'],
  ] as const)('detects %s (%s) as %s', (name, contentType, kind) => {
    expect(attachmentKind(name, contentType)).toBe(kind);
  });
});

describe('isTextContentType', () => {
  it('accepts text types, JSON and XML', () => {
    for (const type of ['text/plain', 'text/html', 'application/json', 'application/xml', 'application/ld+json']) {
      expect(isTextContentType(type), type).toBe(true);
    }
  });

  it('rejects binary types', () => {
    for (const type of ['image/png', 'video/webm', 'application/zip', 'application/octet-stream']) {
      expect(isTextContentType(type), type).toBe(false);
    }
  });
});

describe('comparisonOf', () => {
  it('detects the expected / actual / diff triplet and groups it', () => {
    expect(comparisonOf('square-expected.png', 'image/png')).toEqual({ group: 'square.png', role: 'expected' });
    expect(comparisonOf('square-actual.png', 'image/png')).toEqual({ group: 'square.png', role: 'actual' });
    expect(comparisonOf('square-diff.png', 'image/png')).toEqual({ group: 'square.png', role: 'diff' });
  });

  it('handles names with dashes and no extension', () => {
    expect(comparisonOf('home-page-header-actual', 'image/png')).toEqual({ group: 'home-page-header', role: 'actual' });
  });

  it('ignores other images and the "previous" image', () => {
    expect(comparisonOf('screenshot', 'image/png')).toBeNull();
    expect(comparisonOf('square-previous.png', 'image/png')).toBeNull();
    expect(comparisonOf('diff.png', 'image/png')).toBeNull();
  });

  it('ignores non-image snapshots', () => {
    expect(comparisonOf('data-expected.txt', 'text/plain')).toBeNull();
  });
});

describe('file names', () => {
  it('maps content types to extensions', () => {
    expect(extensionFor('image/png')).toBe('.png');
    expect(extensionFor('text/plain; charset=utf-8')).toBe('.txt');
    expect(extensionFor('text/x-log')).toBe('.txt');
    expect(extensionFor('application/x-unknown')).toBe('.bin');
  });

  it('makes names safe single path segments', () => {
    expect(safeFileName('../../etc/passwd')).toBe('etc-passwd');
    expect(safeFileName('a b/c\\d')).toBe('a-b-c-d');
    expect(safeFileName('.hidden')).toBe('hidden');
    expect(safeFileName('///')).toBe('attachment');
    expect(safeFileName('x'.repeat(300))).toHaveLength(100);
  });

  it('adds an extension to body attachments when missing', () => {
    expect(bodyFileName('response', 'application/json')).toBe('response.json');
    expect(bodyFileName('page.html', 'text/html')).toBe('page.html');
  });

  it('suffixes names that are already taken', () => {
    const taken = new Set<string>();
    expect(uniqueFileName('video.webm', taken)).toBe('video.webm');
    expect(uniqueFileName('video.webm', taken)).toBe('video-1.webm');
    expect(uniqueFileName('video.webm', taken)).toBe('video-2.webm');
    expect(uniqueFileName('trace', taken)).toBe('trace');
    expect(uniqueFileName('trace', taken)).toBe('trace-1');
  });
});

describe('AttachmentStore, names holding a home directory', () => {
  let folder: string;
  let store: AttachmentStore;
  const text = 'text/plain';
  const big = (char: string): Buffer => Buffer.from(char.repeat(5000));
  const read = (file: string | null): string => readFileSync(path.join(folder, file ?? ''), 'utf8');
  /** A file as Playwright writes an attachment: its name flattened into the file name. */
  const source = (name: string, body: string): string => {
    const file = path.join(folder, name);
    writeFileSync(file, body);
    return file;
  };

  beforeEach(() => {
    folder = mkdtempSync(path.join(tmpdir(), 'loupe-store-'));
    store = new AttachmentStore(folder, createPathRewriter({ roots: [], home: '/home/me' }).selection);
  });

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  it('gives two bodies their own file in the same attempt', async () => {
    const first = await store.add('data/t/0', { name: 'a /home/bob/x', contentType: text, body: big('a') });
    const second = await store.add('data/t/0', { name: 'b /home/me/y', contentType: text, body: big('b') });
    expect([first.path, second.path]).toEqual(['data/t/0/attachment.txt', 'data/t/0/attachment-1.txt']);
    expect([read(first.path), read(second.path)]).toEqual(['a'.repeat(5000), 'b'.repeat(5000)]);
  });

  it('gives two copied files their own file in the same attempt', async () => {
    const first = await store.add('data/t/0', { name: '/home/bob/x', contentType: text, path: source('home-bob-x-1.txt', 'one') });
    const second = await store.add('data/t/0', { name: '/home/bob/x', contentType: text, path: source('home-bob-x-2.txt', 'two') });
    expect([first.path, second.path]).toEqual(['data/t/0/attachment.txt', 'data/t/0/attachment-1.txt']);
    expect([read(first.path), read(second.path)]).toEqual(['one', 'two']);
  });

  it('keeps a body, a copied file and an attachment really named so apart', async () => {
    const results = [
      await store.add('data/t/0', { name: 'attachment.txt', contentType: text, body: big('a') }),
      await store.add('data/t/0', { name: '/home/bob/x', contentType: text, body: big('b') }),
      await store.add('data/t/0', { name: '/home/bob/y', contentType: text, path: source('flat.txt', 'c') }),
    ];
    expect(results.map((result) => result.path)).toEqual(['data/t/0/attachment.txt', 'data/t/0/attachment-1.txt', 'data/t/0/attachment-2.txt']);
    expect(results.map((result) => read(result.path).charAt(0))).toEqual(['a', 'b', 'c']);
  });

  it('keeps the extension of a copied file, or the one of the content type', async () => {
    const copied = await store.add('data/t/0', { name: '/home/bob/shot', contentType: 'image/png', path: source('home-bob-shot.png', 'p') });
    const written = await store.add('data/t/0', { name: '/home/bob/shot', contentType: 'image/png', body: Buffer.from('p') });
    expect(copied.path).toBe('data/t/0/attachment.png');
    expect(written.path).toBe('data/t/0/attachment-1.png');
  });

  it('starts again in another attempt', async () => {
    const first = await store.add('data/t/0', { name: '/home/bob/x', contentType: text, body: big('a') });
    const retry = await store.add('data/t/1', { name: '/home/bob/x', contentType: text, body: big('b') });
    expect([first.path, retry.path]).toEqual(['data/t/0/attachment.txt', 'data/t/1/attachment.txt']);
  });

  it('keeps the file name of an attachment holding no home', async () => {
    const result = await store.add('data/t/0', { name: 'my log', contentType: text, body: big('a') });
    expect(result.path).toBe('data/t/0/my-log.txt');
  });

  it('masks the name itself in the rewriting pass only: the store keeps it', async () => {
    const result = await store.add('data/t/0', { name: '/home/bob/x', contentType: text, body: big('a') });
    expect(result.name).toBe('/home/bob/x');
  });
});
