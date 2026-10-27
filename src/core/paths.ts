import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { frameBody, isFrameLine } from '../shared/frames.js';

/**
 * Rewrites the absolute paths of a text so the report does not reveal the
 * machine that wrote it. Three rules, in this order of precedence:
 *
 * 1. A path under a root (the Playwright root dir, or a root derived from
 *    stack frames, see `rootsFromStack`) becomes relative to it, with POSIX
 *    separators: `tests/a.spec.ts`; the root itself becomes `.`. The longest
 *    matching root wins.
 * 2. A path sharing a named ancestor with a root becomes `../` relative:
 *    `../support/session.ts`. A named ancestor is deeper than `/`, a drive,
 *    a UNC share, `/home`, `/Users` or `X:\Users`, so the user name of a
 *    home directory is always in the shared part. The longest matching
 *    ancestor wins; for the same ancestor, the first root in the pool.
 * 3. Any other path keeps its form, except a home directory prefix, which
 *    becomes `~`: the home of the machine writing the report, and the
 *    generic forms `/home/<user>`, `/Users/<user>`, `/root` and
 *    `X:\Users\<user>` (homes of other machines, in merged reports).
 *
 * Rule 2 only applies where the text is known to be a file path: stack frame
 * lines (`    at …`) and error locations. Everywhere else (messages, the
 * message head of a stack, outputs, titles, annotations, text attachments) a
 * path-like text may be something else, such as the path of a URL in
 * `GET /app/items`: there, rules 1 and 3 only, and a path outside every root
 * stays absolute or becomes `~/…`. The head of a stack is rewritten exactly
 * like the message, so a stack without frames still equals its message.
 *
 * Remaining limit: rule 1 still applies to messages, so with a one-segment
 * root (a `testDir` at `/app`), the URL path in `GET /app/items` becomes
 * `GET items`.
 *
 * Prefixes are matched as text, not by splitting paths into tokens, so a
 * path with spaces is handled. A prefix starts at a path boundary (not after
 * a word character, `.`, `~`, `%`, `-` or a separator: the path of a URL
 * such as `http://host/app` is left alone) and ends with a separator or a
 * delimiter (whitespace, a quote, a bracket, `:`, `,`, `;`, `|`). A `file://`
 * URL is matched too, raw or percent-encoded, and loses its scheme.
 *
 * POSIX paths are compared case-sensitively. Windows paths (drive or UNC)
 * are compared case-insensitively, `\` and `/` alike, and the rest of a
 * rewritten Windows path gets `/` separators.
 *
 * `node:internal/…`, `<anonymous>` and relative paths are not absolute and
 * stay as they are.
 */

type Flavor = 'posix' | 'win32';

/** A parsed absolute directory: its filesystem root (`/`, `C:\`, `\\srv\share\`) and its named segments. */
interface Directory {
  flavor: Flavor;
  base: string;
  segments: string[];
}

interface Entry {
  flavor: Flavor;
  /** Length of the prefix as text: the longest prefix wins within a rule. */
  length: number;
  /** Regex sources of the prefix, `file://` not included: raw, then percent-encoded when that differs (URL only). */
  source: string;
  encoded: string | null;
  /** What replaces the prefix; `separator`: a separator followed it and was consumed. */
  replacement: (separator: boolean) => string;
}

/** Characters that end a path prefix when no separator follows it. */
const DELIMITER = `[\\s'"\`<>()[\\]{},;:|]`;
/** The rest of a path after a rewritten prefix: up to a delimiter (`:` included, for `:line:column`). */
const REST = `[^\\s'"\`<>()[\\]{},;|]*`;
/** Before a prefix: not a word character, `.`, `~`, `%`, `-` or a separator. */
const START = `(?<![\\w.~%/\\\\-])`;

function flavorOf(location: string): Flavor | null {
  if (location.startsWith('/')) return 'posix';
  if (/^[A-Za-z]:[\\/]/.test(location) || /^\\\\[^\\/]+[\\/][^\\/]+/.test(location)) return 'win32';
  return null;
}

function parseDirectory(location: string): Directory | null {
  const flavor = flavorOf(location);
  if (flavor === null) return null;
  const impl = path[flavor];
  const normalized = impl.normalize(location);
  const base = impl.parse(normalized).root;
  const segments = normalized.slice(base.length).split(impl.sep).filter((segment) => segment !== '');
  return { flavor, base, segments };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Regex source matching `text`: exact on POSIX; on Windows, case-insensitive with `\` and `/` alike. */
function sourceOf(text: string, flavor: Flavor): string {
  if (flavor === 'posix') return escapeRegExp(text);
  let source = '';
  for (const char of text) {
    if (char === '\\' || char === '/') {
      source += '[\\\\/]';
      continue;
    }
    const lower = char.toLowerCase();
    const upper = char.toUpperCase();
    source += lower !== upper && lower.length === 1 && upper.length === 1 ? `[${lower}${upper}]` : escapeRegExp(char);
  }
  return source;
}

/** `directory` cut to its first `count` named segments, as a path. */
function prefixOf(directory: Directory, count: number): string {
  return directory.base + directory.segments.slice(0, count).join(path[directory.flavor].sep);
}

/** Case-folded on Windows, so the same directory written twice gives one entry. */
function keyOf(text: string, flavor: Flavor): string {
  return flavor === 'win32' ? `w:${text.toLowerCase().replace(/\//g, '\\')}` : `p:${text}`;
}

/** Ancestors made only of a home container (`/home`, `/Users`, `X:\Users`) are not named. */
function isHomeContainer(directory: Directory, count: number): boolean {
  if (count !== 1) return false;
  const segment = directory.segments[0] as string;
  return directory.flavor === 'posix' ? segment === 'home' || segment === 'Users' : segment.toLowerCase() === 'users';
}

function up(levels: number, separator: boolean): string {
  const parents = Array<string>(levels).fill('..').join('/');
  return separator ? `${parents}/` : parents;
}

/** Generic home directories, rule 3. A user name with a space only counts when a separator follows it. */
const GENERIC_HOMES: readonly Entry[] = [
  {
    flavor: 'posix',
    length: 0,
    source: `/(?:home|Users)/(?:[^/\\r\\n'"\`<>|:]+(?=/)|[^/\\s'"\`<>()|:]+)`,
    encoded: null,
    replacement: home,
  },
  { flavor: 'posix', length: 0, source: '/root', encoded: null, replacement: home },
  {
    flavor: 'win32',
    length: 0,
    source: `[A-Za-z]:[\\\\/][Uu][Ss][Ee][Rr][Ss][\\\\/](?:[^\\\\/\\r\\n'"\`<>|:*?]+(?=[\\\\/])|[^\\\\/\\s'"\`<>()|:*?]+)`,
    encoded: null,
    replacement: home,
  },
];

function home(separator: boolean): string {
  return separator ? '~/' : '~';
}

/**
 * True when `directory` is strictly inside `ancestor`: both absolute, of the
 * same kind (POSIX or Windows), with the same filesystem root, `ancestor`'s
 * segments first. Windows paths are compared case-insensitively.
 */
export function isStrictlyUnder(directory: string, ancestor: string): boolean {
  const inner = parseDirectory(directory);
  const outer = parseDirectory(ancestor);
  if (!inner || !outer || inner.flavor !== outer.flavor || inner.segments.length <= outer.segments.length) return false;
  const fold = (text: string): string => (inner.flavor === 'win32' ? text.toLowerCase() : text);
  return fold(inner.base) === fold(outer.base) && outer.segments.every((segment, index) => fold(segment) === fold(inner.segments[index] as string));
}

export interface PathRewriterOptions {
  /**
   * Absolute directories paths are made relative to, in priority order:
   * `config.rootDir` first, then the roots derived from stack frames. A
   * directory without a named segment (`/`, `C:\`) is ignored.
   */
  roots: readonly string[];
  /** Home directory of the machine writing the report (`os.homedir()`); null: generic forms only. */
  home: string | null;
}

export interface PathRewriter {
  /** A message, an output, a title...: rules 1 and 3. */
  text(text: string): string;
  /** An absolute file path (an error location): rules 1 to 3. */
  file(file: string): string;
  /**
   * A stack: its head (every line before the first frame line) exactly as
   * `text`, so a stack without frames still equals its message; frame lines
   * with rules 1 to 3; any other line after them as `text`.
   */
  stack(stack: string): string;
}

/** Returns the rewriter of a report, see the top of this module. */
export function createPathRewriter(options: PathRewriterOptions): PathRewriter {
  const roots: Entry[] = [];
  const ancestors: Entry[] = [];
  const homes: Entry[] = [];
  // Roots and ancestors share one set (a root is never also an ancestor); homes have their own,
  // so a home that is also an ancestor is still masked where rule 2 does not apply.
  const seen = new Set<string>();
  const seenHomes = new Set<string>();
  const add = (list: Entry[], directory: Directory, count: number, replacement: Entry['replacement']): void => {
    const prefix = prefixOf(directory, count);
    const key = keyOf(prefix, directory.flavor);
    const keys = list === homes ? seenHomes : seen;
    if (keys.has(key)) return;
    keys.add(key);
    const url = pathToFileURL(prefix, { windows: directory.flavor === 'win32' }).href.slice('file://'.length);
    const raw = directory.flavor === 'win32' ? `/${prefix.replace(/\\/g, '/')}` : prefix;
    list.push({
      flavor: directory.flavor,
      length: prefix.length,
      source: sourceOf(prefix, directory.flavor),
      encoded: url === raw ? null : sourceOf(url, directory.flavor),
      replacement,
    });
  };

  const directories = options.roots
    .map(parseDirectory)
    .filter((directory): directory is Directory => directory !== null && directory.segments.length > 0);
  for (const directory of directories) {
    add(roots, directory, directory.segments.length, (separator) => (separator ? '' : '.'));
  }
  for (const directory of directories) {
    for (let count = directory.segments.length - 1; count >= 1; count--) {
      if (isHomeContainer(directory, count)) continue;
      const levels = directory.segments.length - count;
      add(ancestors, directory, count, (separator) => up(levels, separator));
    }
  }
  const homeDirectory = options.home === null ? null : parseDirectory(options.home);
  if (homeDirectory && homeDirectory.segments.length > 0) add(homes, homeDirectory, homeDirectory.segments.length, home);
  homes.push(...GENERIC_HOMES);

  // Longest first within a rule: alternatives are tried in order at each position.
  const byLength = (a: Entry, b: Entry): number => b.length - a.length;
  roots.sort(byLength);
  ancestors.sort(byLength);
  const text = compile([...roots, ...homes]);
  const file = compile([...roots, ...ancestors, ...homes]);

  return {
    text,
    file,
    stack(stack) {
      const lines = stack.split('\n');
      const first = lines.findIndex(isFrameLine);
      if (first === -1) return text(stack);
      const head = first === 0 ? [] : [text(lines.slice(0, first).join('\n'))];
      return [...head, ...lines.slice(first).map((line) => (isFrameLine(line) ? file(line) : text(line)))].join('\n');
    },
  };
}

/** One regex for `entries`, in order: each raw (optionally in a `file://` URL), then percent-encoded in a `file://` URL. */
function compile(entries: readonly Entry[]): (text: string) => string {
  const alternatives: string[] = [];
  const owners: Entry[] = [];
  for (const entry of entries) {
    alternatives.push(`(?:file:\\/\\/\\/?)?(${entry.source})`);
    owners.push(entry);
    if (entry.encoded === null) continue;
    alternatives.push(`file:\\/\\/(${entry.encoded})`);
    owners.push(entry);
  }
  const pattern = new RegExp(`${START}(?:${alternatives.join('|')})(?:([\\\\/])|(?=${DELIMITER}|$))(${REST})`, 'g');

  return (text) => {
    if (!text.includes('/') && !text.includes('\\')) return text;
    return text.replace(pattern, (match: string, ...groups: unknown[]) => {
      const index = groups.findIndex((group, position) => position < owners.length && group !== undefined);
      const owner = owners[index] as Entry;
      const separator = groups[owners.length] !== undefined;
      let rest = groups[owners.length + 1] as string;
      if (owner.flavor === 'win32') rest = rest.replace(/\\/g, '/');
      if (match.startsWith('file:')) rest = decode(rest);
      return owner.replacement(separator) + rest;
    });
  };
}

/**
 * Keys whose values are never rewritten: identifiers and signatures, category
 * names (computed from the original text), snippets (source code, already in
 * the repository), attachment paths (files in the report folder) and
 * locations (rewritten from their absolute file by the core).
 */
const KEPT_KEYS = new Set(['id', 'signature', 'errorSignature', 'category', 'categories', 'snippet', 'path', 'location']);

/**
 * Rewrites the paths of every string of a report: `stack` values as stacks,
 * everything else as text, except under KEPT_KEYS. Returns a copy.
 */
export function rewriteReportPaths<T>(value: T, paths: PathRewriter): T {
  const visit = (node: unknown, key: string | null): unknown => {
    if (typeof node === 'string') return key === 'stack' ? paths.stack(node) : paths.text(node);
    if (Array.isArray(node)) return node.map((child) => visit(child, key));
    if (node !== null && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node).map(([name, child]) => [name, KEPT_KEYS.has(name) ? child : visit(child, name)]));
    }
    return node;
  };
  return visit(value, null) as T;
}

function decode(text: string): string {
  if (!text.includes('%')) return text;
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

const NAMED = /^.+? \((.+)\)$/;
const POSITION = /^(.*?):\d+(?::\d+)?$/;

/** The file of a V8 stack frame location: no `file://`, percent-decoded, no `:line:column`. */
function frameFile(location: string): string {
  let file = POSITION.exec(location)?.[1] ?? location;
  if (file.startsWith('file://')) {
    file = decode(file.slice('file://'.length));
    // `file:///C:/x` leaves `/C:/x`.
    if (/^\/[A-Za-z]:\//.test(file)) file = file.slice(1);
  }
  return file;
}

/**
 * Roots shown by the frames of a stack: for each frame in `testFile` (the
 * test's own file, relative to the root dir, POSIX separators), the frame's
 * path without `/<testFile>`. The path must have a separator right before
 * `testFile`. Used when the stack comes from another machine (`merge-reports`
 * with a merge config): the root dir of the report is then not the root of
 * the stack. Windows paths are compared case-insensitively. Empty for a test
 * file outside the root dir (`../…`).
 */
export function rootsFromStack(stack: string, testFile: string): string[] {
  if (testFile === '' || testFile.split('/').includes('..')) return [];
  const roots = new Set<string>();
  for (const line of stack.split('\n')) {
    const body = frameBody(line)?.replace(/^async /, '');
    if (body === undefined) continue;
    const file = frameFile(NAMED.exec(body)?.[1] ?? body);
    const flavor = flavorOf(file);
    if (flavor === null) continue;
    const comparable = flavor === 'win32' ? file.replace(/\\/g, '/').toLowerCase() : file;
    const suffix = `/${flavor === 'win32' ? testFile.toLowerCase() : testFile}`;
    if (!comparable.endsWith(suffix)) continue;
    const root = file.slice(0, file.length - suffix.length);
    if (root !== '' && !/^[A-Za-z]:$/.test(root)) roots.add(root);
  }
  return [...roots];
}
