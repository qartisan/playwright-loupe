/**
 * File paths in the sidebar: the directory prefix shared by every file is
 * not repeated, and long file names are cut in the middle, never at the
 * start, keeping the extension. Pure functions, no DOM: unit-tested in Node.
 */

export function toPosix(path: string): string {
  return path.replace(/\\/g, '/');
}

/**
 * The longest directory prefix shared by all files, with its trailing `/`
 * (`tests/e2e/`); empty when there is none. Only whole directories count:
 * `tests/a.spec.ts` and `tests-b/c.spec.ts` share nothing. A single file
 * gives its directory.
 */
export function commonDirectoryPrefix(files: Iterable<string>): string {
  let common: string[] | null = null;
  for (const file of files) {
    const directories = toPosix(file).split('/').slice(0, -1);
    if (common === null) {
      common = directories;
      continue;
    }
    let length = 0;
    while (length < common.length && length < directories.length && common[length] === directories[length]) length += 1;
    common.length = length;
    if (length === 0) break;
  }
  return common && common.length > 0 ? `${common.join('/')}/` : '';
}

/** `file` without `prefix` (POSIX separators); unchanged when it does not start with it. */
export function stripPrefix(file: string, prefix: string): string {
  const posix = toPosix(file);
  return prefix !== '' && posix.startsWith(prefix) ? posix.slice(prefix.length) : posix;
}

/** Characters kept before the extension in the tail of a long file name. */
const TAIL_STEM = 4;

/**
 * Splits a file name for a middle ellipsis: the head may be cut (the CSS
 * puts the ellipsis at its end), the tail always shows. The tail is the
 * extension, up to two short parts (`.spec.ts`), preceded by the last
 * characters of the name when it is long: `checkout-flow-guest.spec.ts` →
 * `checkout-flow-g` + `uest.spec.ts`.
 */
export function splitForMiddleEllipsis(name: string): [head: string, tail: string] {
  const extension = /(?:\.[^./]{1,6}){1,2}$/.exec(name.slice(1))?.[0] ?? '';
  const stem = name.slice(0, name.length - extension.length);
  const kept = stem.length > TAIL_STEM * 3 ? TAIL_STEM : 0;
  return [stem.slice(0, stem.length - kept), `${stem.slice(stem.length - kept)}${extension}`];
}
