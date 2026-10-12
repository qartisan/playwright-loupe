import type { DimensionDefinition } from '../schema/v1.js';

const PREFIXED_TAG = /^@([^:\s]+):(.+)$/;

/**
 * Dimensions from prefixed tags: `@layer:api` → `{ layer: ['api'] }`.
 * Unprefixed tags produce nothing. Values keep their declaration order and are
 * deduplicated; everything after the first ':' is the value.
 */
export function tagDimensions(tags: readonly string[]): Record<string, string[]> {
  const dimensions: Record<string, string[]> = {};
  for (const tag of tags) {
    const match = PREFIXED_TAG.exec(tag);
    if (!match) continue;
    const [, prefix = '', value = ''] = match;
    const values = (dimensions[prefix] ??= []);
    if (!values.includes(value)) values.push(value);
  }
  return dimensions;
}

/** Definitions of the tag dimensions in `names`, sorted by name. */
export function usedTagDimensions(names: ReadonlySet<string>): DimensionDefinition[] {
  return [...names].sort().map((name) => ({ name, source: 'tag', key: name }));
}
