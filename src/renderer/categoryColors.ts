import type { CategoryDefinition } from '../schema/v1.js';
import { NEUTRAL_ENTRY, paletteEntryByReference } from '../shared/palette.js';
import { deriveTriplet, isHex, type Triplet } from '../shared/color.js';

/**
 * Badge colors of a category, per theme. A palette reference color gets the
 * palette's hand-tuned triplets; any other color gets triplets derived from it
 * whose lightness is adjusted until the contrast rules pass. Pure: unit-tested.
 */
export interface CategoryColors {
  light: Triplet;
  dark: Triplet;
}

const cache = new Map<string, CategoryColors>();

export function categoryColors(color: string | undefined): CategoryColors {
  const key = color && isHex(color) ? color.toLowerCase() : NEUTRAL_ENTRY.reference;
  let colors = cache.get(key);
  if (!colors) {
    const entry = paletteEntryByReference(key);
    colors = entry ? { light: entry.light, dark: entry.dark } : { light: deriveTriplet(key, 'light'), dark: deriveTriplet(key, 'dark') };
    cache.set(key, colors);
  }
  return colors;
}

/** CSS custom properties for a category badge; the stylesheet picks the set of the active theme. */
export function categoryStyle(color: string | undefined): Record<string, string> {
  const { light, dark } = categoryColors(color);
  return {
    '--cat-text-light': light.text,
    '--cat-bg-light': light.bg,
    '--cat-border-light': light.border,
    '--cat-text-dark': dark.text,
    '--cat-bg-dark': dark.bg,
    '--cat-border-dark': dark.border,
  };
}

export function categoryColorMap(categories: readonly CategoryDefinition[]): Map<string, string> {
  return new Map(categories.map((category) => [category.name, category.color]));
}
