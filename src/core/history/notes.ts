import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { RunNotes } from '../../schema/history-v1.js';
import { NOTES_VERSION, type NotesFileStatus } from '../../schema/notes-v1.js';
import { suggestKey } from '../../config/validate.js';
import { cutText } from './cut.js';
import type { Replay } from './read.js';

/**
 * Reads loupe.notes.json (docs/schema/notes-v1.md): exclusions and notes added after the fact to recorded runs.
 * Never throws and never stops a run: a missing file is normal, an invalid one gives problems for the run's
 * single history warning and no entry. Problems never repeat the file's text, which people write and which may
 * hold a path or a secret: syntax errors are located by Loupe (never `JSON.parse`'s message, which quotes the
 * source), and key names are masked and cut before they are printed.
 */

/** Largest notes file read: 1 MiB, where a file of a few hundred entries is a few tens of kB. */
export const MAX_NOTES_BYTES = 1024 * 1024;
/** Longest exclusion reason kept from the file, as `LOUPE_EXCLUDE`'s. */
export const MAX_NOTES_REASON = 200;
/** Longest note kept, as an error extract. */
export const MAX_NOTE = 300;
/** Entries or keys named in a problem, at most. */
const NAMED = 3;
/** Characters of an unknown key's name printed, at most, once masked. */
const KEY_CHARS = 40;
/** Between the texts of entries for the same run (several people may each add one). */
export const JOIN = '; ';

const ENTRY_KEYS = ['run', 'exclude', 'note'] as const;
const TOP_KEYS = ['notesVersion', 'runs'] as const;

/** An entry as the file gives it: trimmed, not masked yet. */
export interface NotesEntryRead {
  run: string;
  exclude: string | null;
  note: string | null;
}

export interface NotesRead {
  status: NotesFileStatus;
  /** The valid entries, in file order; empty unless `read`. */
  entries: NotesEntryRead[];
  /** Problems for the run's single history warning; empty when none. */
  problems: string[];
}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

const WHITESPACE = new Set([' ', '\t', '\n', '\r']);
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const LITERALS = ['true', 'false', 'null'] as const;

/**
 * `text` with every trailing comma (a comma after a value, before `]` or `}`) replaced by a space, so that
 * positions do not move. Commas inside strings are kept: the scan follows strings and their escapes. Any other
 * comma stays, so `[,]` and `[1,,]` remain errors.
 */
export function blankTrailingCommas(text: string): string {
  let out = '';
  let from = 0;
  let last = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (c === '"') {
      // To the closing quote, or the end of a text whose string is not closed.
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
      last = '"';
      continue;
    }
    if (WHITESPACE.has(c)) continue;
    if (c === ',' && last !== '' && !'[{,:'.includes(last)) {
      let next = i + 1;
      while (next < text.length && WHITESPACE.has(text[next] as string)) next++;
      if (text[next] === ']' || text[next] === '}') {
        out += `${text.slice(from, i)} `;
        from = i + 1;
        continue;
      }
    }
    last = c;
  }
  return from === 0 ? text : out + text.slice(from);
}

/** Where the first syntax error of `text` is, and what it is, in words that never quote the text. Null when it is valid JSON. */
export function findSyntaxError(text: string): { index: number; problem: string } | null {
  const n = text.length;
  const stack: string[] = [];
  let i = 0;
  let state: 'value' | 'first-value' | 'key' | 'first-key' | 'after' = 'value';
  const fail = (problem: string, at = i) => ({ index: Math.min(at, n), problem });

  const scanString = (): { index: number; problem: string } | null => {
    const start = i;
    for (i++; i < n; i++) {
      const code = text.charCodeAt(i);
      if (code === 0x22) {
        i++;
        return null;
      }
      if (code === 0x5c) {
        const escape = text[i + 1];
        if (escape === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) return fail('invalid \\u escape in a string');
          i += 5;
        } else if (escape !== undefined && '"\\/bfnrt'.includes(escape)) {
          i++;
        } else {
          return fail('invalid escape in a string');
        }
        continue;
      }
      if (code === 0x0a || code === 0x0d) return fail('a string is not closed on its line');
      if (code < 0x20) return fail('a control character in a string must be escaped');
    }
    return fail('a string is not closed', start);
  };

  const scanNumber = (): { index: number; problem: string } | null => {
    NUMBER.lastIndex = i;
    const match = NUMBER.exec(text);
    if (match === null) return fail('invalid number');
    i += match[0].length;
    return /[0-9.eE+-]/.test(text[i] ?? '') ? fail('invalid number') : null;
  };

  const scanLiteral = (): { index: number; problem: string } | null => {
    const word = LITERALS.find((literal) => text.startsWith(literal, i));
    if (word === undefined || /[A-Za-z0-9_$]/.test(text[i + word.length] ?? '')) return fail('expected a value');
    i += word.length;
    return null;
  };

  for (;;) {
    while (i < n && WHITESPACE.has(text[i] as string)) i++;
    if (i >= n) {
      if (state === 'after' && stack.length === 0) return null;
      return fail(stack.length === 0 && state === 'value' ? 'the file is empty' : 'the file ends before the JSON does');
    }
    const c = text[i] as string;
    if (c === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) return fail('comments are not allowed');
    if (c === "'") return fail('strings must be in double quotes');
    if (state === 'after') {
      const top = stack[stack.length - 1];
      if (top === undefined) return fail('text after the end of the JSON');
      if (c === ',') {
        i++;
        state = top === '[' ? 'value' : 'key';
      } else if ((top === '[' && c === ']') || (top === '{' && c === '}')) {
        stack.pop();
        i++;
      } else {
        return fail(top === '[' ? 'expected "," or "]"' : 'expected "," or "}"');
      }
      continue;
    }
    if (state === 'key' || state === 'first-key') {
      if (state === 'first-key' && c === '}') {
        stack.pop();
        i++;
        state = 'after';
        continue;
      }
      if (c !== '"') return fail('expected a key in double quotes');
      const error = scanString();
      if (error) return error;
      while (i < n && WHITESPACE.has(text[i] as string)) i++;
      if (text[i] !== ':') return fail('expected ":" after a key');
      i++;
      state = 'value';
      continue;
    }
    // A value is expected.
    if (state === 'first-value' && c === ']') {
      stack.pop();
      i++;
      state = 'after';
      continue;
    }
    if (c === '{' || c === '[') {
      stack.push(c);
      i++;
      state = c === '{' ? 'first-key' : 'first-value';
      continue;
    }
    const error = c === '"' ? scanString() : c === '-' || (c >= '0' && c <= '9') ? scanNumber() : scanLiteral();
    if (error) return error;
    state = 'after';
  }
}

/** Line and column of `index`, from 1: a line ends at LF, CRLF or CR; a column counts characters. */
export function lineAndColumn(text: string, index: number): { line: number; column: number } {
  let line = 1;
  let start = 0;
  for (let i = 0; i < index; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x0a || (code === 0x0d && text.charCodeAt(i + 1) !== 0x0a)) {
      line++;
      start = i + 1;
    }
  }
  return { line, column: [...text.slice(start, index)].length + 1 };
}

/** The first items of a list, then how many more. */
function named(items: readonly string[]): string {
  const shown = items.slice(0, NAMED).join(', ');
  return items.length > NAMED ? `${shown} and ${items.length - NAMED} more` : shown;
}

/** Why an entry cannot be used, or the entry. */
function readEntry(value: unknown): NotesEntryRead | string {
  if (!isObject(value)) return 'not an object';
  const text = (key: string): string | null | 'invalid' => {
    const item = value[key];
    if (item === undefined) return null;
    return typeof item === 'string' && item.trim() !== '' ? item.trim() : 'invalid';
  };
  const run = text('run');
  if (run === null) return 'no "run"';
  if (run === 'invalid') return '"run" is not a non-empty string';
  const exclude = text('exclude');
  const note = text('note');
  if (exclude === 'invalid') return '"exclude" is not a non-empty string';
  if (note === 'invalid') return '"note" is not a non-empty string';
  if (exclude === null && note === null) return 'neither "exclude" nor "note"';
  return { run, exclude, note };
}

/**
 * The text of a notes file, once read: its entries, or why it is invalid. `name` names the file in problems;
 * `mask` masks a key name before it is printed (the redaction of the run).
 *
 * Lenient where people and other tools are: a UTF-8 BOM (Notepad), CRLF line ends, trailing commas before `]`
 * and `}` (a pasted entry left last). Everything else follows JSON: any other syntax error, a newer
 * `notesVersion` or a wrong shape makes the file invalid. An entry that cannot be used is ignored and named by
 * position; a key Loupe does not know (from a newer version, a typo) is warned about, the rest used.
 */
export function parseNotes(source: string, name: string, mask: (text: string) => string): NotesRead {
  const invalid = (why: string): NotesRead => ({ status: 'invalid', entries: [], problems: [`${name} is invalid, so its entries are ignored: ${why}`] });
  const text = blankTrailingCommas(source.charCodeAt(0) === 0xfeff ? source.slice(1) : source);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    // Never the parser's message: it quotes the text around the error.
    const error = findSyntaxError(text);
    if (error === null) return invalid('it is not valid JSON');
    const { line, column } = lineAndColumn(text, error.index);
    return invalid(`it is not valid JSON at line ${line}, column ${column} (${error.problem})`);
  }
  if (!isObject(value)) return invalid('it must be a JSON object with "notesVersion" and "runs"');
  const version = value['notesVersion'];
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) return invalid(`"notesVersion" must be ${NOTES_VERSION}`);
  if (version > NOTES_VERSION) return invalid(`it was written for a newer Loupe (notesVersion ${version}; this one reads ${NOTES_VERSION})`);
  const runs = value['runs'];
  if (runs !== undefined && !Array.isArray(runs)) return invalid('"runs" must be an array');

  const shownKey = (key: string) => JSON.stringify(cutText(mask(key), KEY_CHARS));
  const unknown: string[] = [];
  const unknownKeys = (object: Record<string, unknown>, known: readonly string[], at: string) => {
    for (const key of Object.keys(object)) {
      if (known.includes(key)) continue;
      const suggestion = suggestKey(key, known);
      unknown.push(`${at}${shownKey(key)}${suggestion ? ` (did you mean "${suggestion}"?)` : ''}`);
    }
  };
  unknownKeys(value, TOP_KEYS, '');
  const entries: NotesEntryRead[] = [];
  const ignored: string[] = [];
  (runs ?? []).forEach((item: unknown, index) => {
    if (isObject(item)) unknownKeys(item, ENTRY_KEYS, `runs[${index}].`);
    const entry = readEntry(item);
    if (typeof entry === 'string') ignored.push(`runs[${index}] (${entry})`);
    else entries.push(entry);
  });
  const problems: string[] = [];
  if (ignored.length > 0) problems.push(`${name}: ignored ${ignored.length === 1 ? 'an invalid entry' : `${ignored.length} invalid entries`}: ${named(ignored)}`);
  if (unknown.length > 0) problems.push(`${name}: ignored ${unknown.length === 1 ? 'an unknown key' : `${unknown.length} unknown keys`}: ${named(unknown)}`);
  return { status: 'read', entries, problems };
}

const code = (error: unknown): string => (error as NodeJS.ErrnoException | null)?.code ?? 'unknown error';

/**
 * Reads the notes file at `file` (null: `history.notes: false`). Never throws. `cwd` names the file in problems
 * relative to the working directory, never as an absolute path; `mask` is the redaction of the run.
 */
export async function readNotes(file: string | null, cwd: string, mask: (text: string) => string): Promise<NotesRead> {
  if (file === null) return { status: 'off', entries: [], problems: [] };
  const relative = path.relative(cwd, file);
  const name = relative === '' || path.isAbsolute(relative) ? path.basename(file) : relative;
  const unreadable = (why: string): NotesRead => ({ status: 'invalid', entries: [], problems: [`${name} could not be read, so its entries are ignored (${why})`] });
  let content: Buffer;
  try {
    const info = await stat(file);
    if (!info.isFile()) return unreadable('it is not a file');
    if (info.size > MAX_NOTES_BYTES) return unreadable(`it is larger than 1 MB`);
    content = await readFile(file);
  } catch (error) {
    return code(error) === 'ENOENT' ? { status: 'absent', entries: [], problems: [] } : unreadable(code(error));
  }
  if (content.length > MAX_NOTES_BYTES) return unreadable('it is larger than 1 MB');
  try {
    return parseNotes(content.toString('utf8'), name, mask);
  } catch {
    // A safety net: the parse is written not to throw.
    return unreadable('it could not be parsed');
  }
}

/**
 * The notes file as the report names it (`EmbeddedHistory.notesPath`), so the copied exclusion can say where it
 * goes: relative to the Playwright config's folder (`baseDir`, where `history.notes` is resolved from), with `/`
 * separators on every platform; null with `history.notes: false`. Never an absolute path: with no relative form
 * (another drive on Windows) or none to show (the folder itself), the bare file name. A relative path climbing out
 * of the folder (`..`) can spell a home directory or a `redact.env` value that the absolute path holds
 * (`../../home/runner/loupe.notes.json`): the bare file name too. Then masked like the file's own texts.
 */
export function notesPath(file: string | null, baseDir: string, mask: (text: string) => string, paths: path.PlatformPath = path): string | null {
  if (file === null) return null;
  const relative = paths.relative(baseDir, file);
  const climbs = relative === '..' || relative.startsWith(`..${paths.sep}`);
  const bare = relative === '' || paths.isAbsolute(relative) || (climbs && mask(file) !== file);
  return mask((bare ? paths.basename(file) : relative).split(paths.sep).join('/'));
}

/**
 * What the file says about each run, by run id: the reasons and notes of its entries joined (several people may
 * each add one; the same text once), masked with the redaction of the run (`redact.env`, home directory), then cut.
 * Mask, then cut: cut first, a value running across the cut would only be partly there when masking ran.
 * The file is read whole on every run, so its text is never cut before it is masked.
 */
export function notesByRun(entries: readonly NotesEntryRead[], replay: Replay): Map<string, RunNotes> {
  const grouped = new Map<string, { exclude: string[]; note: string[] }>();
  for (const entry of entries) {
    const group = grouped.get(entry.run) ?? { exclude: [], note: [] };
    if (entry.exclude !== null && !group.exclude.includes(entry.exclude)) group.exclude.push(entry.exclude);
    if (entry.note !== null && !group.note.includes(entry.note)) group.note.push(entry.note);
    grouped.set(entry.run, group);
  }
  const result = new Map<string, RunNotes>();
  for (const [run, group] of grouped) {
    const notes: RunNotes = {};
    if (group.exclude.length > 0) notes.notesExcluded = cutText(replay(group.exclude.join(JOIN)), MAX_NOTES_REASON);
    if (group.note.length > 0) notes.note = cutText(replay(group.note.join(JOIN)), MAX_NOTE);
    result.set(run, notes);
  }
  return result;
}
