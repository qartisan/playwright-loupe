import type { Annotation } from '../schema/v1.js';

/**
 * Annotation lists merged, shared by the reporter (dimensions) and the
 * renderer (test detail, AI prompt, skip reason). Since Playwright 1.52, each
 * attempt's annotations start with a copy of the test's static annotations,
 * so the test and attempt lists of a report usually repeat each other.
 */

/** Same type and same description; a missing description is a value of its own. */
function sameAnnotation(a: Annotation, b: Annotation): boolean {
  return a.type === b.type && a.description === b.description;
}

/** The annotations of every list, in order, without exact duplicates (type and description). */
export function mergeAnnotations(...lists: readonly (readonly Annotation[])[]): Annotation[] {
  const merged: Annotation[] = [];
  for (const annotation of lists.flat()) {
    if (!merged.some((known) => sameAnnotation(known, annotation))) merged.push(annotation);
  }
  return merged;
}
