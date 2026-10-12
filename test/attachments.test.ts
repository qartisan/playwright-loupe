import { describe, expect, it } from 'vitest';
import {
  attachmentKind,
  bodyFileName,
  comparisonOf,
  extensionFor,
  isTextContentType,
  safeFileName,
  uniqueFileName,
} from '../src/core/attachments.js';

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
