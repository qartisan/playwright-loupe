import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { LoupeReport } from '../schema/v1.js';
import { frameBody, isFrameLine } from '../shared/frames.js';
import { renameDimensions } from './dimensions.js';

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
 *    a UNC share or what holds home directories (see `isHomeContainer`), so
 *    the user name of a home directory is always in the shared part. The
 *    longest matching ancestor wins; for the same ancestor, the first root in
 *    the pool.
 * 3. Any other path keeps its form, except a home directory prefix, which
 *    becomes `~`: the home of the machine writing the report, and the
 *    generic forms of `GENERIC_HOMES` (homes of other machines, in merged
 *    reports, or printed by a tool).
 *
 * Rule 2 only applies where the text is known to be a file path: stack frame
 * lines (`    at …`) and error locations. Everywhere else (messages, the
 * message head of a stack, outputs, step titles, annotations, text attachments) a
 * path-like text may be something else, such as the path of a URL in
 * `GET /app/items`: there, rules 1 and 3 only, and a path outside every root
 * stays absolute or becomes `~/…`. The head of a stack is rewritten exactly
 * like the message, so a stack without frames still equals its message.
 *
 * Remaining limit: rule 1 still applies to messages, so with a one-segment
 * root (a `testDir` at `/app`), the URL path in `GET /app/items` becomes
 * `GET items`.
 *
 * The fields that select a test (test and `describe` titles, project names)
 * follow none of these rules: a rerun command matches their text against the
 * real test, so only a home directory prefix changes, to `~`, and the rest stays
 * exactly as written (see `PathRewriter.selection`). The builder reads `~` as any
 * text, which a rewritten remainder would not match.
 *
 * Prefixes are matched as text, not by splitting paths into tokens, so a
 * path with spaces is handled. A prefix starts at a path boundary (not after
 * a word character, `.`, `~`, `%`, `-` or a separator: the path of a URL
 * such as `http://host/app` is left alone) and ends with a separator or a
 * delimiter (whitespace, a quote, a bracket, `:`, `,`, `;`, `=`, `|`). A
 * `file://` URL is matched too, raw or percent-encoded, and loses its scheme.
 *
 * POSIX paths are compared case-sensitively. Windows paths (drive or UNC)
 * are compared case-insensitively, `\` and `/` alike, a `\` possibly escaped
 * (`C:\\Users`, as `expect` and `JSON.stringify` print it), and the rest of
 * a rewritten Windows path gets `/` separators.
 *
 * Whatever the rules leave, a final sweep (`PathRewriter.selection`, on the
 * result of `text` and `file`) masks: rule 3 cuts a path at a delimiter, not
 * at `:` or `=`, so it misses the second path of `/home/me/a:/home/me/b`. In
 * the sweep, the home of the machine writing the report, when it has at least
 * two segments, needs no boundary before it: `-L/home/me/lib` becomes `-L~/lib`
 * and `http://host/home/me/x` becomes `http://host~/x`. It is the user name.
 *
 * On Windows, Playwright converts a `file://` stack frame itself: `\` for every
 * `/`, so a POSIX path loses its drive (`\home\me\x`) and a share its leading
 * `\\` (`wsl.localhost\Ubuntu\home\me\x`). The generic homes have these forms
 * too, and a UNC root also matches without its `\\` (its ancestors do not).
 * Accepted false positive: `D:\home\bob\x` becomes `D:~/x`.
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

export interface Entry {
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
const DELIMITER = `[\\s'"\`<>()[\\]{},;:=|]`;
/** The rest of a path after a rewritten prefix: up to a delimiter (`:` included, for `:line:column`). */
const REST = `[^\\s'"\`<>()[\\]{},;|]*`;
/** Before a prefix: not a word character, `.`, `~`, `%`, `-` or a separator. */
const START = `(?<![\\w.~%/\\\\-])`;
/** A Windows separator: `/`, or `\` possibly escaped (one or more). */
const WINDOWS_SEPARATOR = '(?:\\\\+|/)';
/** After a generic user name: it does not end with whitespace or a list separator, which would take the next path for its rest. */
const NAME_END = '(?<![\\s,;=])';

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
      source += WINDOWS_SEPARATOR;
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

/**
 * Ancestors that only hold home directories are not named: `/home`, `/Users`, `/var`, `/var/home`,
 * `X:\\Users`, the `home` of a WSL share, and a mounted drive down to its `Users` (`/mnt/c`, `/mnt/c/Users`,
 * the same under `/cygdrive`). Named, they would give `../../Users/me/x`, which no mask can catch.
 */
function isHomeContainer(directory: Directory, count: number): boolean {
  const [first, second, third] = directory.segments as [string, string?, string?];
  if (directory.flavor === 'win32') {
    return count === 1 && (first.toLowerCase() === 'users' || (first === 'home' && /^\\\\wsl(?:\$|\.localhost)\\/i.test(directory.base)));
  }
  if ((first === 'mnt' || first === 'cygdrive') && /^[A-Za-z]$/.test(second ?? '')) {
    return count <= 2 || (count === 3 && third?.toLowerCase() === 'users');
  }
  if (first === 'var') return count === 1 || (count === 2 && second === 'home');
  return count === 1 && (first === 'home' || first === 'Users');
}

function up(levels: number, separator: boolean): string {
  const parents = Array<string>(levels).fill('..').join('/');
  return separator ? `${parents}/` : parents;
}

/**
 * A user name on Linux or macOS. With a space, it only counts when a separator follows it: `GET /home/dashboard
 * returns 200` reads `GET ~ returns 200`, and `/Users/John Doe/x` masks `Doe`.
 */
const POSIX_NAME = (separator: string): string =>
  `(?:[^${separator}\\r\\n'"\`<>|:]+(?=[${separator}])|[^${separator}\\s'"\`<>()|:]+)${NAME_END}`;
/**
 * A Windows profile name, spaces included, which nothing tells from the words after it: it runs up to a character
 * Windows forbids in a file name or a line break, and stops before a drive. Masking too much beats leaking.
 */
const WINDOWS_NAME = `(?:(?![A-Za-z]:(?:\\\\|/))[^\\\\/:*?"<>|\\r\\n])+${NAME_END}`;
const USERS = sourceOf('Users', 'win32');

/** Generic home directories, rule 3. Exported for test/leak.integration.test.ts, which keeps scripts/home-paths.mjs aligned. */
export const GENERIC_HOMES: readonly Entry[] = [
  { flavor: 'posix', length: 0, source: `/(?:home|Users|var/home)/${POSIX_NAME('/')}`, encoded: null, replacement: home },
  { flavor: 'posix', length: 0, source: '/root', encoded: null, replacement: home },
  { flavor: 'win32', length: 0, source: `[A-Za-z]:${WINDOWS_SEPARATOR}${USERS}${WINDOWS_SEPARATOR}${WINDOWS_NAME}`, encoded: null, replacement: home },
  // WSL and Cygwin, any case.
  { flavor: 'posix', length: 0, source: `/(?:mnt|cygdrive)/[A-Za-z]/${USERS}/${WINDOWS_NAME}`, encoded: null, replacement: home },
  // MSYS and Git Bash: as they print it, so that the URL path `/a/users/42` stays.
  { flavor: 'posix', length: 0, source: `/[A-Za-z]/Users/${WINDOWS_NAME}`, encoded: null, replacement: home },
  // A WSL home seen from Windows.
  {
    flavor: 'win32',
    length: 0,
    source: `(?:\\\\{2,}|//)(?:${sourceOf('wsl$', 'win32')}|${sourceOf('wsl.localhost', 'win32')})${WINDOWS_SEPARATOR}[^\\\\/\\r\\n]+${WINDOWS_SEPARATOR}home${WINDOWS_SEPARATOR}${POSIX_NAME('\\\\/')}`,
    encoded: null,
    replacement: home,
  },
  // Converted by Playwright on Windows: its own `fileURLToPath` (playwright-core) writes a `file://` frame
  // with `\`, without a drive for a POSIX path and without the leading `\\` of a share. Windows paths, so
  // the rest gets `/`; a `\` possibly escaped; `Users` any case, `home` lowercase.
  { flavor: 'win32', length: 0, source: `\\\\+(?:home|var${WINDOWS_SEPARATOR}home)${WINDOWS_SEPARATOR}${POSIX_NAME('\\\\/')}`, encoded: null, replacement: home },
  { flavor: 'win32', length: 0, source: `\\\\+${USERS}${WINDOWS_SEPARATOR}${POSIX_NAME('\\\\/')}`, encoded: null, replacement: home },
  { flavor: 'win32', length: 0, source: '\\\\+root', encoded: null, replacement: home },
  { flavor: 'win32', length: 0, source: `\\\\+(?:mnt|cygdrive)${WINDOWS_SEPARATOR}[A-Za-z]${WINDOWS_SEPARATOR}${USERS}${WINDOWS_SEPARATOR}${WINDOWS_NAME}`, encoded: null, replacement: home },
  { flavor: 'win32', length: 0, source: `\\\\+[A-Za-z]${WINDOWS_SEPARATOR}${USERS}${WINDOWS_SEPARATOR}${WINDOWS_NAME}`, encoded: null, replacement: home },
  {
    flavor: 'win32',
    length: 0,
    source: `(?:${sourceOf('wsl$', 'win32')}|${sourceOf('wsl.localhost', 'win32')})${WINDOWS_SEPARATOR}[^\\\\/\\r\\n]+${WINDOWS_SEPARATOR}home${WINDOWS_SEPARATOR}${POSIX_NAME('\\\\/')}`,
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
  /** A message, an output, a step title...: rules 1 and 3, then the final sweep. */
  text(text: string): string;
  /** An absolute file path (an error location): rules 1 to 3, then the final sweep. */
  file(file: string): string;
  /**
   * A stack: its head (every line before the first frame line) exactly as
   * `text`, so a stack without frames still equals its message; frame lines
   * with rules 1 to 3; any other line after them as `text`.
   */
  stack(stack: string): string;
  /**
   * A field that selects a test, and the final sweep of the other text: every
   * home directory prefix becomes `~`, the rest stays as written (separators,
   * percent-encoding, paths under a root).
   */
  selection(text: string): string;
  /**
   * A code snippet: only the home of the machine writing the report becomes `~`, when it has
   * at least two segments. A generic form or a single segment could be anything in source
   * code (`page.goto('/home/dashboard')`, `page.goto('/app/items')`), and a single segment
   * holds no user name. The caret under the line the snippet points at keeps pointing at the
   * same character.
   */
  snippet(snippet: string): string;
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
  /** `converted`: a UNC prefix without its leading `\\`, as Playwright writes a `file://` frame on Windows (see `GENERIC_HOMES`). */
  const add = (list: Entry[], directory: Directory, count: number, replacement: Entry['replacement'], converted = false): void => {
    const prefix = converted ? prefixOf(directory, count).slice(2) : prefixOf(directory, count);
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
      encoded: converted || url === raw ? null : sourceOf(url, directory.flavor),
      replacement,
    });
  };

  const directories = options.roots
    .map(parseDirectory)
    .filter((directory): directory is Directory => directory !== null && directory.segments.length > 0);
  const toRoot = (separator: boolean): string => (separator ? '' : '.');
  for (const directory of directories) {
    add(roots, directory, directory.segments.length, toRoot);
    // A root only, not its ancestors: a converted path outside it falls to the generic homes.
    if (directory.flavor === 'win32' && directory.base.startsWith('\\\\')) add(roots, directory, directory.segments.length, toRoot, true);
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
  // A single segment (`/root`, `/app`) can be anything in a path: it keeps the boundary before it.
  const anywhere = homeDirectory && homeDirectory.segments.length >= 2 ? (homes[0] as Entry) : null;
  const realHome = compileHomes(anywhere ? [anywhere] : [], anywhere);
  homes.push(...GENERIC_HOMES);

  // Longest first within a rule: alternatives are tried in order at each position.
  const byLength = (a: Entry, b: Entry): number => b.length - a.length;
  roots.sort(byLength);
  ancestors.sort(byLength);
  const selection = compileHomes(homes, anywhere);
  const swept =
    (rewrite: (text: string) => string) =>
    (text: string): string =>
      selection(rewrite(text));
  const text = swept(compile([...roots, ...homes]));
  const file = swept(compile([...roots, ...ancestors, ...homes]));

  return {
    text,
    file,
    selection: (text) => selection(text),
    snippet: (snippet) => rewriteSnippet(snippet, realHome),
    stack(stack) {
      const lines = stack.split('\n');
      const first = lines.findIndex(isFrameLine);
      if (first === -1) return text(stack);
      const head = first === 0 ? [] : [text(lines.slice(0, first).join('\n'))];
      return [...head, ...lines.slice(first).map((line) => (isFrameLine(line) ? file(line) : text(line)))].join('\n');
    },
  };
}

/**
 * A regex source for the prefixes of `entries`, in order: each raw (optionally in a `file://` URL),
 * then percent-encoded in a `file://` URL. `anywhere`, raw, comes first and needs no boundary before
 * it. `owners[index]` owns capture group `index + 1`; the next group is the separator after the prefix.
 */
function prefixes(entries: readonly Entry[], anywhere: Entry | null = null): { source: string; owners: Entry[] } {
  const alternatives: string[] = [];
  const owners: Entry[] = anywhere ? [anywhere] : [];
  for (const entry of entries) {
    alternatives.push(`(?:file:\\/\\/\\/?)?(${entry.source})`);
    owners.push(entry);
    if (entry.encoded === null) continue;
    alternatives.push(`file:\\/\\/(${entry.encoded})`);
    owners.push(entry);
  }
  const bounded = `${START}(?:${alternatives.join('|')})`;
  const start = anywhere ? `(?:(${anywhere.source})|${bounded})` : bounded;
  return { source: `${start}(?:(\\\\+|/)|(?=${DELIMITER}|$))`, owners };
}

/** Each prefix and the rest of its path, rewritten. */
function compile(entries: readonly Entry[]): (text: string) => string {
  const { source, owners } = prefixes(entries);
  const pattern = new RegExp(`${source}(${REST})`, 'g');

  return (text) => {
    if (!text.includes('/') && !text.includes('\\')) return text;
    return text.replace(pattern, (match: string, ...groups: unknown[]) => {
      const index = groups.findIndex((group, position) => position < owners.length && group !== undefined);
      const owner = owners[index] as Entry;
      const separator = groups[owners.length] !== undefined;
      let rest = groups[owners.length + 1] as string;
      if (owner.flavor === 'win32') rest = rest.replace(/\\+/g, '/');
      if (match.startsWith('file:')) rest = decode(rest);
      return owner.replacement(separator) + rest;
    });
  };
}

/** Each home prefix alone becomes `~`, with the separator it had. `replaced` hears of each one, in order. */
type HomeMask = (text: string, replaced?: (offset: number, length: number, width: number) => void) => string;

function compileHomes(entries: readonly Entry[], anywhere: Entry | null): HomeMask {
  if (entries.length === 0) return (text) => text;
  const { source, owners } = prefixes(entries, anywhere);
  const pattern = new RegExp(source, 'g');
  return (text, replaced) => {
    if (!text.includes('/') && !text.includes('\\')) return text;
    return text.replace(pattern, (match: string, ...groups: unknown[]) => {
      const masked = `~${(groups[owners.length] as string | undefined) ?? ''}`;
      replaced?.(groups[owners.length + 1] as number, match.length, masked.length);
      return masked;
    });
  };
}

/** The line a snippet points at, `> 38 | …`, and the caret under it, `     |    ^`: same columns. */
const ARROW_LINE = /^>\s*\d+ \|/;
const CARET_LINE = /^(\s*\|\s*)(\^+\s*)$/;

function rewriteSnippet(snippet: string, mask: HomeMask): string {
  const lines = snippet.split('\n');
  lines.forEach((line, index) => {
    const caret = ARROW_LINE.test(line) ? CARET_LINE.exec(lines[index + 1] ?? '') : null;
    if (!caret) {
      lines[index] = mask(line);
      return;
    }
    const column = (caret[1] as string).length;
    // The columns before the caret follow the edits of the line, tabs included. A caret inside a
    // home moves to its `~`. `shift`: how far the edits so far moved the rest of the line.
    let margin = caret[1] as string;
    let shift = 0;
    lines[index] = mask(line, (offset, length, width) => {
      if (offset >= column) return;
      const inside = offset + length > column;
      margin = margin.slice(0, offset + shift) + ' '.repeat(inside ? 0 : width) + margin.slice(offset + length + shift);
      shift += width - length;
    });
    lines[index + 1] = margin + (caret[2] as string);
  });
  return lines.join('\n');
}

/**
 * Keys whose values are never rewritten: identifiers and signatures, category
 * names (computed from the original text), attachment paths (files in the
 * report folder, whose names hold no home directory, see `AttachmentStore`) and
 * locations (rewritten from their absolute file by the core).
 */
const KEPT_KEYS = new Set(['id', 'signature', 'errorSignature', 'category', 'categories', 'path', 'location']);

/**
 * Rewrites the paths of every string of a report: `stack` values as stacks,
 * `snippet` values as snippets, everything else as text, except under KEPT_KEYS,
 * and the names in `tests[].dimensions`, the only keys that come from a test. The fields that select a test
 * are found by position, not by key: steps have a `title` too, and `name` is also
 * that of attachments, categories and dimensions. Returns a copy.
 */
export function rewriteReportPaths(report: LoupeReport, paths: PathRewriter): LoupeReport {
  const visit = (node: unknown, key: string | null): unknown => {
    if (typeof node === 'string') {
      if (key === 'stack') return paths.stack(node);
      return key === 'snippet' ? paths.snippet(node) : paths.text(node);
    }
    if (Array.isArray(node)) return node.map((child) => visit(child, key));
    if (node !== null && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node).map(([name, child]) => [name, KEPT_KEYS.has(name) ? child : visit(child, name)]));
    }
    return node;
  };
  const rewrite = <T>(value: T): T => visit(value, null) as T;
  const rest = rewrite({ ...report, run: { ...report.run, errors: [] }, projects: [], tests: [] });
  return {
    ...rest,
    run: {
      ...rest.run,
      errors: report.run.errors.map((error) => ({ ...rewrite(error), project: error.project === null ? null : paths.selection(error.project) })),
    },
    projects: report.projects.map((project) => ({ ...rewrite(project), name: paths.selection(project.name) })),
    tests: report.tests.map((test) => ({
      ...rewrite(test),
      project: paths.selection(test.project),
      suitePath: test.suitePath.map((title) => paths.selection(title)),
      title: paths.selection(test.title),
      dimensions: renameDimensions(rewrite(test.dimensions), (name) => paths.text(name)),
    })),
  };
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
