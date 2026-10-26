import { describe, expect, it } from 'vitest';
import { slug, uniqueIds } from '../src/renderer/ids.js';

describe('slug', () => {
  it('turns spaces, quotes and punctuation into single hyphens, lowercase', () => {
    expect(slug('Test type')).toBe('test-type');
    expect(slug('Team "core"')).toBe('team-core');
    expect(slug("  O'Brien's  area ")).toBe('o-brien-s-area');
  });

  it('drops accents and keeps letters of any script', () => {
    expect(slug('Qualité')).toBe('qualite');
    expect(slug('Équipe 2')).toBe('equipe-2');
    expect(slug('優先度')).toBe('優先度');
  });

  it('is empty when nothing is left', () => {
    expect(slug('"?!"')).toBe('');
  });
});

describe('uniqueIds', () => {
  it('gives each name an id without whitespace', () => {
    const ids = uniqueIds('w-dimension-', ['Test type', 'Team "core"', 'Layer']);
    expect([...ids]).toEqual([
      ['Test type', 'w-dimension-test-type'],
      ['Team "core"', 'w-dimension-team-core'],
      ['Layer', 'w-dimension-layer'],
    ]);
    for (const id of ids.values()) expect(id).toMatch(/^\S+$/);
  });

  it('keeps ids unique when names give the same slug, in the order given', () => {
    const ids = uniqueIds('w-dimension-', ['Test type', 'test-type', 'TEST TYPE']);
    expect([...ids.values()]).toEqual(['w-dimension-test-type', 'w-dimension-test-type-2', 'w-dimension-test-type-3']);
  });

  it('keeps ids unique when a name already looks like a suffixed slug', () => {
    const ids = uniqueIds('w-', ['a', 'A', 'a 2']);
    expect([...ids.values()]).toEqual(['w-a', 'w-a-2', 'w-a-2-2']);
    expect(new Set(ids.values()).size).toBe(3);
  });

  it('uses "item" for a name with an empty slug', () => {
    expect([...uniqueIds('w-', ['?', '!']).values()]).toEqual(['w-item', 'w-item-2']);
  });

  it('gives a repeated name one id', () => {
    expect([...uniqueIds('w-', ['x', 'x'])]).toEqual([['x', 'w-x']]);
  });
});
