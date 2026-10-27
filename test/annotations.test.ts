import { describe, expect, it } from 'vitest';
import type { Annotation } from '../src/schema/v1.js';
import { mergeAnnotations } from '../src/shared/annotations.js';

const bug: Annotation = { type: 'bug', description: 'BUG-1' };
const slow: Annotation = { type: 'slow', description: null };

describe('mergeAnnotations', () => {
  it("removes an attempt's copy of a test annotation", () => {
    expect(mergeAnnotations([bug], [{ type: 'bug', description: 'BUG-1' }])).toEqual([bug]);
  });

  it('removes duplicates with and without description, but keeps them apart', () => {
    expect(mergeAnnotations([slow, bug], [{ type: 'slow', description: null }, bug])).toEqual([slow, bug]);
    expect(mergeAnnotations([slow], [{ type: 'slow', description: '' }, { type: 'slow', description: 'why' }])).toEqual([
      slow,
      { type: 'slow', description: '' },
      { type: 'slow', description: 'why' },
    ]);
  });

  it('compares type and description, never one alone', () => {
    expect(mergeAnnotations([bug], [{ type: 'issue', description: 'BUG-1' }, { type: 'bug', description: 'BUG-2' }])).toHaveLength(3);
  });

  it('keeps the order: test annotations first, then attempt-only ones', () => {
    const runtime: Annotation = { type: 'step', description: 'runtime' };
    expect(mergeAnnotations([bug, slow], [runtime, slow, bug])).toEqual([bug, slow, runtime]);
  });

  it('keeps an attempt-only annotation', () => {
    expect(mergeAnnotations([], [bug])).toEqual([bug]);
    expect(mergeAnnotations([slow], [bug])).toEqual([slow, bug]);
  });

  it('removes duplicates inside one list too', () => {
    expect(mergeAnnotations([bug, bug])).toEqual([bug]);
  });

  it('gives an empty list for empty lists', () => {
    expect(mergeAnnotations()).toEqual([]);
    expect(mergeAnnotations([], [])).toEqual([]);
  });
});
