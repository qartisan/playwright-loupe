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
