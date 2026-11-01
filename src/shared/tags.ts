/**
 * Prefixed tags, shared by the reporter (which turns them into dimensions)
 * and the renderer (which leaves them out of the tag filter when a dimension
 * uses their prefix): `@layer:api` → prefix `layer`, value `api`; everything
 * after the first ':' is the value. Unprefixed tags (`@smoke`) have neither.
 */

const PREFIXED_TAG = /^@([^:\s]+):(.+)$/;

export function splitPrefixedTag(tag: string): { prefix: string; value: string } | null {
  const match = PREFIXED_TAG.exec(tag);
  return match ? { prefix: match[1] ?? '', value: match[2] ?? '' } : null;
}

/**
 * The values of a test for a dimension. A name comes from a tag or a config, so an inherited property
 * is not one: `dimensions['constructor']` would be a function.
 */
export function dimensionValues(dimensions: Readonly<Record<string, string[]>>, name: string): readonly string[] {
  return Object.hasOwn(dimensions, name) ? (dimensions[name] as string[]) : [];
}
