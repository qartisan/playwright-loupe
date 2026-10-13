import { describe, expect, it } from 'vitest';
import type { ResolvedDimension } from '../src/config/types.js';
import { DEFAULT_DIMENSIONS, annotationValues, createDimensions, tagDimensions } from '../src/core/dimensions.js';

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

describe('annotationValues', () => {
  it('uses the descriptions of the annotations of one type, deduplicated', () => {
    const annotations = [
      { type: 'bug', description: 'BUG-1' },
      { type: 'owner', description: 'qa' },
      { type: 'bug', description: 'BUG-2' },
      { type: 'bug', description: 'BUG-1' },
    ];
    expect(annotationValues(annotations, 'bug')).toEqual(['BUG-1', 'BUG-2']);
  });

  it('ignores annotations without description', () => {
    expect(annotationValues([{ type: 'bug', description: null }, { type: 'bug', description: ' ' }], 'bug')).toEqual([]);
  });
});

describe('createDimensions', () => {
  const layer: ResolvedDimension = { name: 'Layer', from: 'tag', prefix: 'layer', values: ['api', 'ui', 'e2e'] };
  const bug: ResolvedDimension = { name: 'Bug', from: 'annotation', type: 'bug', values: null };
  const tags = ['@layer:api', '@area:checkout', '@smoke'];
  const annotations = [
    { type: 'bug', description: 'BUG-1' },
    { type: 'bug', description: 'BUG-2' },
  ];

  it('keeps automatic tag dimensions by default', () => {
    const dimensions = createDimensions(DEFAULT_DIMENSIONS);
    expect(dimensions.of(tags, annotations)).toEqual({ layer: ['api'], area: ['checkout'] });
    expect(dimensions.definitions(new Set(['layer', 'area']))).toEqual([
      { name: 'area', source: 'tag', key: 'area', values: null },
      { name: 'layer', source: 'tag', key: 'layer', values: null },
    ]);
  });

  it('gives several values to a test with several annotations of the type', () => {
    expect(createDimensions({ auto: false, definitions: [bug] }).of(tags, annotations)).toEqual({ Bug: ['BUG-1', 'BUG-2'] });
  });

  it('lets a configured tag dimension replace the automatic one of its prefix', () => {
    const dimensions = createDimensions({ auto: true, definitions: [layer, bug] });
    expect(dimensions.of(tags, annotations)).toEqual({ Layer: ['api'], Bug: ['BUG-1', 'BUG-2'], area: ['checkout'] });
    expect(dimensions.definitions(new Set(['Layer', 'Bug', 'area']))).toEqual([
      { name: 'Layer', source: 'tag', key: 'layer', values: ['api', 'ui', 'e2e'] },
      { name: 'Bug', source: 'annotation', key: 'bug', values: null },
      { name: 'area', source: 'tag', key: 'area', values: null },
    ]);
  });

  it('records the expected values without checking them', () => {
    const dimensions = createDimensions({ auto: true, definitions: [layer] });
    expect(dimensions.of(['@layer:typo'], [])).toEqual({ Layer: ['typo'] });
    expect(dimensions.definitions(new Set())[0]?.values).toEqual(['api', 'ui', 'e2e']);
  });

  it('lists configured dimensions even when no test uses them', () => {
    const dimensions = createDimensions({ auto: true, definitions: [bug] });
    expect(dimensions.of(['@layer:api'], [])).toEqual({ layer: ['api'] });
    expect(dimensions.definitions(new Set(['layer'])).map((d) => d.name)).toEqual(['Bug', 'layer']);
  });

  it('drops automatic dimensions when auto is false', () => {
    const dimensions = createDimensions({ auto: false, definitions: [layer] });
    expect(dimensions.of(tags, annotations)).toEqual({ Layer: ['api'] });
    expect(dimensions.definitions(new Set(['Layer', 'area'])).map((d) => d.name)).toEqual(['Layer']);
  });

  it('drops an automatic dimension whose name a configured dimension uses', () => {
    const owner: ResolvedDimension = { name: 'area', from: 'annotation', type: 'owner', values: null };
    const dimensions = createDimensions({ auto: true, definitions: [owner] });
    expect(dimensions.of(['@area:checkout'], [{ type: 'owner', description: 'qa' }])).toEqual({ area: ['qa'] });
  });
});
