/**
 * Element ids built from user data (dimension names). An id must hold no
 * whitespace (`aria-labelledby` and `aria-controls` take a space-separated
 * list of ids) and be unique in the document, so names are slugged and
 * slugs made unique. Pure functions, no DOM: unit-tested in Node.
 */

/**
 * Lowercase letters and digits of any script, runs of anything else (spaces,
 * quotes, punctuation) turned into one `-`, accents dropped; empty when
 * nothing is left.
 */
export function slug(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * One id per distinct name, `<prefix><slug>`, in the order given: a name
 * whose slug is taken (`Test type` and `test-type`) gets `-2`, `-3`… A name
 * with an empty slug uses `item`.
 */
export function uniqueIds(prefix: string, names: Iterable<string>): Map<string, string> {
  const ids = new Map<string, string>();
  const taken = new Set<string>();
  for (const name of names) {
    if (ids.has(name)) continue;
    const base = `${prefix}${slug(name) || 'item'}`;
    let id = base;
    for (let suffix = 2; taken.has(id); suffix += 1) id = `${base}-${suffix}`;
    taken.add(id);
    ids.set(name, id);
  }
  return ids;
}
