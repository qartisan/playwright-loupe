import { frameBody } from '../../shared/frames.js';

/**
 * Stack frames of an error, as V8 prints them: `at fn (path:line:col)` and
 * `at path:line:col`, with `async `, `new ` and `[as alias]` variants.
 * Playwright strips its own frames from the stacks it reports, but keeps
 * third-party ones (`node_modules`) and may keep `node:` internals: library
 * frames are excluded here (`isLibraryFrame`).
 *
 * The core writes frame paths relative to the Playwright root dir (`../` when
 * outside it, see src/core/paths.ts); a path outside every root and home stays
 * absolute.
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
    let body = frameBody(text)?.trim();
    if (body === undefined) continue;
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
