/**
 * Stack frames of an error, as V8 prints them: `at fn (path:line:col)` and
 * `at path:line:col`, with `async `, `new ` and `[as alias]` variants.
 * Playwright already strips `node_modules`, `node:` internals and its own
 * frames from the stacks it reports; they are excluded here too, for stacks
 * that kept them.
 *
 * Pure functions, no DOM: unit-tested in Node.
 */

export interface StackFrame {
  /** Cleaned function name (`Class.method`, `login`); null for an anonymous frame. */
  fn: string | null;
  /** POSIX separators, no `file://`, percent-decoding applied. */
  path: string;
  /** 1-based; null when the frame has no position. */
  line: number | null;
}

const FRAME_LINE = /^\s+at (.+)$/;
const NAMED = /^(.+?) \((.+)\)$/;
const POSITION = /^(.*?):(\d+)(?::\d+)?$/;

/** `file:///C:/a%20b/x.ts` → `C:/a b/x.ts`; `C:\a\x.ts` → `C:/a/x.ts`. */
export function normalizeFramePath(location: string): string {
  let path = location;
  if (path.startsWith('file://')) path = path.slice('file://'.length);
  if (path.includes('%')) {
    try {
      path = decodeURIComponent(path);
    } catch {
      // A literal `%` in a path: kept as is.
    }
  }
  path = path.replace(/\\/g, '/');
  // `file:///C:/x` leaves `/C:/x`.
  return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path;
}

/**
 * The function name as written in the source: without `async `, `new `, a
 * leading `Object.` (a method of an object literal or a module), a trailing
 * `[as alias]` and `<anonymous>`. `Class.method` is kept. Null when nothing
 * is left.
 */
export function cleanFunctionName(raw: string | null): string | null {
  if (raw === null) return null;
  const name = raw
    .replace(/^async /, '')
    .replace(/^new /, '')
    .replace(/\s*\[as [^\]]*\]$/, '')
    .replace(/^Object\./, '')
    .replace(/<anonymous>/g, '')
    .replace(/^\.+|\.+$/g, '')
    .trim();
  return name === '' ? null : name;
}

export function parseStack(stack: string | null): StackFrame[] {
  if (!stack) return [];
  const frames: StackFrame[] = [];
  for (const text of stack.split('\n')) {
    const match = FRAME_LINE.exec(text);
    if (!match) continue;
    let body = (match[1] as string).trim();
    // `at async /path/x.ts:1:2`: an anonymous async frame.
    if (body.startsWith('async ') && !NAMED.test(body)) body = body.slice('async '.length);
    const named = NAMED.exec(body);
    const location = normalizeFramePath(named ? (named[2] as string) : body);
    const position = POSITION.exec(location);
    frames.push({
      fn: cleanFunctionName(named ? (named[1] as string) : null),
      path: position ? (position[1] as string) : location,
      line: position ? Number(position[2]) : null,
    });
  }
  return frames;
}

/** Frames that are not the user's code: `node_modules`, `node:` internals, Playwright's own files, V8 natives. */
export function isLibraryFrame(path: string): boolean {
  return (
    /(?:^|\/)node_modules\//.test(path) ||
    path.startsWith('node:') ||
    /(?:^|\/)playwright(?:-core)?\/lib\//.test(path) ||
    path === 'native' ||
    path === '<anonymous>'
  );
}

/**
 * `path` relative to `root` (an absolute directory with a trailing `/`),
 * with `../` segments when it is outside: `../pages/login.page.ts`. A path
 * that shares nothing with the root (another drive) stays absolute.
 */
export function relativeToRoot(path: string, root: string): string {
  if (path.startsWith(root)) return path.slice(root.length);
  // POSIX roots start with an empty segment, Windows ones with the drive (`C:`).
  const from = root.replace(/\/$/, '').split('/');
  const to = path.split('/');
  let common = 0;
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common += 1;
  if (common === 0) return path;
  return [...Array<string>(from.length - common).fill('..'), ...to.slice(common)].join('/');
}
