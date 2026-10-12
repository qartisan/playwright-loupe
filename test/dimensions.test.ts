import { describe, expect, it } from 'vitest';
import { tagDimensions, usedTagDimensions } from '../src/core/dimensions.js';

describe('tagDimensions', () => {
  it('turns prefixed tags into dimensions named after the prefix', () => {
    expect(tagDimensions(['@layer:api', '@priority:p1'])).toEqual({ layer: ['api'], priority: ['p1'] });
  });

  it('ignores unprefixed tags', () => {
    expect(tagDimensions(['@smoke', '@layer:ui', '@regression'])).toEqual({ layer: ['ui'] });
  });

  it('collects several values for the same prefix, without duplicates', () => {
    expect(tagDimensions(['@layer:ui', '@layer:api', '@layer:ui'])).toEqual({ layer: ['ui', 'api'] });
  });

  it('keeps everything after the first colon as the value', () => {
    expect(tagDimensions(['@ticket:JIRA:42'])).toEqual({ ticket: ['JIRA:42'] });
  });

  it('ignores tags with an empty prefix or value', () => {
    expect(tagDimensions(['@:api', '@layer:', '@'])).toEqual({});
  });

  it('keeps the case of prefixes and values', () => {
    expect(tagDimensions(['@Module:4B'])).toEqual({ Module: ['4B'] });
  });

  it('returns an empty object without tags', () => {
    expect(tagDimensions([])).toEqual({});
  });
});

describe('usedTagDimensions', () => {
  it('describes each dimension as a tag source keyed by its prefix, sorted by name', () => {
    expect(usedTagDimensions(new Set(['layer', 'area']))).toEqual([
      { name: 'area', source: 'tag', key: 'area' },
      { name: 'layer', source: 'tag', key: 'layer' },
    ]);
  });
});
