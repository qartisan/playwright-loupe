import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_NOTE, MAX_NOTES_BYTES, MAX_NOTES_REASON, blankTrailingCommas, findSyntaxError, lineAndColumn, notesByRun, notesPath, parseNotes, readNotes } from '../src/core/history/notes.js';
import { cutText } from '../src/core/history/cut.js';
import { createReplay } from '../src/core/history/read.js';
import { REDACTED } from '../src/core/redact.js';

const NAME = 'loupe.notes.json';
/** A redact.env value, and a home directory of the machine that reads the file. */
const SECRET = 'n0tes-s3cret-v4lue';
const HOME = '/home/notesuser';
const replay = createReplay({ mode: 'extend', patterns: [], values: [SECRET] }, HOME);
const mask = (text: string) => replay(text);

const parse = (text: string) => parseNotes(text, NAME, mask);
const file = (runs: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({ notesVersion: 1, runs, ...extra });

describe('notes file: what is read', () => {
  it('reads entries with an exclusion, a note or both, trimmed', () => {
    const read = parse(file([{ run: 'a', exclude: ' staging down ' }, { run: ' b ', note: 'first run after the refactor' }, { run: 'c', exclude: 'x', note: 'y' }]));
    expect(read).toEqual({
      status: 'read',
      entries: [
        { run: 'a', exclude: 'staging down', note: null },
        { run: 'b', exclude: null, note: 'first run after the refactor' },
        { run: 'c', exclude: 'x', note: 'y' },
      ],
      problems: [],
    });
  });

  it('a file without runs, or with an empty array, has no entry and no problem', () => {
    expect(parse('{ "notesVersion": 1 }')).toEqual({ status: 'read', entries: [], problems: [] });
    expect(parse('{ "notesVersion": 1, "runs": [] }')).toEqual({ status: 'read', entries: [], problems: [] });
  });

  it('accepts a UTF-8 BOM (Notepad on Windows writes one)', () => {
    expect(parse(`\uFEFF${file([{ run: 'a', note: 'n' }])}`).entries).toHaveLength(1);
  });

  it('accepts CRLF line ends, and counts lines across them', () => {
    expect(parse('{\r\n  "notesVersion": 1,\r\n  "runs": [\r\n    { "run": "a", "note": "n" }\r\n  ]\r\n}\r\n').entries).toHaveLength(1);
    expect(parse('{\r\n  "notesVersion": 1,\r\n  "runs": [ x ]\r\n}').problems).toEqual([`${NAME} is invalid, so its entries are ignored: it is not valid JSON at line 3, column 13 (expected a value)`]);
  });

  it('accepts trailing commas before ] and }, without a warning', () => {
    const text = '{\n  "notesVersion": 1,\n  "runs": [\n    { "run": "a", "exclude": "down", },\n    { "run": "b", "note": "n" },\n  ],\n}\n';
    expect(parse(text)).toEqual({ status: 'read', entries: [{ run: 'a', exclude: 'down', note: null }, { run: 'b', exclude: null, note: 'n' }], problems: [] });
  });

  it('a trailing comma is blanked only outside strings, after a value: positions never move', () => {
    expect(blankTrailingCommas('[1, ]')).toBe('[1  ]');
    expect(blankTrailingCommas('{"a": ",]", "b": "\\",}",}')).toBe('{"a": ",]", "b": "\\",}" }');
    expect(blankTrailingCommas('[,]')).toBe('[,]');
    expect(blankTrailingCommas('[1,,]')).toBe('[1,,]');
    expect(blankTrailingCommas('{"a":,}')).toBe('{"a":,}');
    expect(parse('{ "notesVersion": 1, "runs": [{ "run": "a", "note": "ends with ,]" },] }').entries[0]?.note).toBe('ends with ,]');
  });

  it('joins nothing yet: duplicates are kept as entries', () => {
    expect(parse(file([{ run: 'a', exclude: 'x' }, { run: 'a', exclude: 'y' }])).entries).toHaveLength(2);
  });
});

describe('notes file: invalid files', () => {
  const invalid = (text: string) => {
    const read = parse(text);
    expect(read.status).toBe('invalid');
    expect(read.entries).toEqual([]);
    expect(read.problems).toHaveLength(1);
    return read.problems[0] as string;
  };
  const why = (text: string) => invalid(text).replace(`${NAME} is invalid, so its entries are ignored: `, '');

  it.each([
    ['', 'it is not valid JSON at line 1, column 1 (the file is empty)'],
    ['{ "notesVersion": 1, "runs": [ { "run": "a" } ', 'it is not valid JSON at line 1, column 47 (the file ends before the JSON does)'],
    ['{ "notesVersion": 1, // the version\n "runs": [] }', 'it is not valid JSON at line 1, column 22 (comments are not allowed)'],
    ['{ "notesVersion": 1 /* the version */ }', 'it is not valid JSON at line 1, column 21 (comments are not allowed)'],
    ['{ "notesVersion": /1 }', 'it is not valid JSON at line 1, column 19 (expected a value)'],
    ["{ 'notesVersion': 1 }", 'it is not valid JSON at line 1, column 3 (strings must be in double quotes)'],
    ['{ "notesVersion": 1 "runs": [] }', 'it is not valid JSON at line 1, column 21 (expected "," or "}")'],
    ['{ "notesVersion": 1, "runs": [ {} {} ] }', 'it is not valid JSON at line 1, column 35 (expected "," or "]")'],
    ['{ notesVersion: 1 }', 'it is not valid JSON at line 1, column 3 (expected a key in double quotes)'],
    ['{ "notesVersion" 1 }', 'it is not valid JSON at line 1, column 18 (expected ":" after a key)'],
    ['{ "notesVersion": 01 }', 'it is not valid JSON at line 1, column 20 (invalid number)'],
    ['{ "notesVersion": tru }', 'it is not valid JSON at line 1, column 19 (expected a value)'],
    ['{ "a": "x\\q" }', 'it is not valid JSON at line 1, column 10 (invalid escape in a string)'],
    ['{ "a": "\\u12" }', 'it is not valid JSON at line 1, column 9 (invalid \\u escape in a string)'],
    ['{ "a": "two\nlines" }', 'it is not valid JSON at line 1, column 12 (a string is not closed on its line)'],
    ['{ "a": "tab\there" }', 'it is not valid JSON at line 1, column 12 (a control character in a string must be escaped)'],
    ['{ "a": "never closed', 'it is not valid JSON at line 1, column 8 (a string is not closed)'],
    ['{ "notesVersion": 1 } {}', 'it is not valid JSON at line 1, column 23 (text after the end of the JSON)'],
    ['{ "notesVersion": 1, "runs": [,] }', 'it is not valid JSON at line 1, column 31 (expected a value)'],
    ['{ "notesVersion": 1, "runs": [{ "run": "a" },,] }', 'it is not valid JSON at line 1, column 46 (expected a value)'],
  ])('a syntax error is located by Loupe: %j', (text, expected) => {
    expect(why(text)).toBe(expected);
  });

  it("never repeats the file's text around a syntax error, as JSON.parse's message does", () => {
    // A value left unquoted: V8 says "Unexpected token" and quotes the text around it.
    const text = `{\n  "notesVersion": 1,\n  "runs": [\n    { "run": "a", "note": ${HOME}/x ${SECRET} }\n  ]\n}`;
    let parserMessage = '';
    try {
      JSON.parse(text);
    } catch (error) {
      parserMessage = (error as Error).message;
    }
    // The positive control: V8 quotes the source next to the error.
    expect(parserMessage).toContain('/home/note');
    const problem = invalid(text);
    expect(problem).not.toContain('/home');
    expect(problem).toBe(`${NAME} is invalid, so its entries are ignored: it is not valid JSON at line 4, column 27 (expected a value)`);
  });

  it('positions count characters, not UTF-16 units, and lines end at LF, CRLF or CR', () => {
    expect(lineAndColumn('a\nb\r\nc\rd', 7)).toEqual({ line: 4, column: 1 });
    expect(lineAndColumn('"😀" x', 5)).toEqual({ line: 1, column: 5 });
    expect(why('{ "a": "😀" x }')).toBe('it is not valid JSON at line 1, column 12 (expected "," or "}")');
  });

  it('agrees with JSON.parse on valid JSON', () => {
    for (const text of ['{}', '[]', '{"a":[1,-2.5e+3,true,false,null,"\\u00e9\\n"],"b":{}}', ' \t\r\n[ { } , [ ] ] ', '"x"', '0', '-0.1E-2']) {
      expect(findSyntaxError(text), text).toBeNull();
      expect(() => JSON.parse(text)).not.toThrow();
    }
  });

  it.each([
    ['[]', 'it must be a JSON object with "notesVersion" and "runs"'],
    ['"notes"', 'it must be a JSON object with "notesVersion" and "runs"'],
    ['{ "runs": [] }', '"notesVersion" must be 1'],
    ['{ "notesVersion": "1", "runs": [] }', '"notesVersion" must be 1'],
    ['{ "notesVersion": 0, "runs": [] }', '"notesVersion" must be 1'],
    ['{ "notesVersion": 1.5, "runs": [] }', '"notesVersion" must be 1'],
    ['{ "notesVersion": 2, "runs": [] }', 'it was written for a newer Loupe (notesVersion 2; this one reads 1)'],
    ['{ "notesVersion": 2, "runs": "another shape" }', 'it was written for a newer Loupe (notesVersion 2; this one reads 1)'],
    ['{ "notesVersion": 1, "runs": {} }', '"runs" must be an array'],
  ])('a wrong shape or a newer version makes it invalid: %s', (text, expected) => {
    expect(why(text)).toBe(expected);
  });
});

describe('notes file: entries and keys', () => {
  it('ignores invalid entries, counts them and names them by position, and uses the others', () => {
    const read = parse(
      file([
        { run: 'ok', note: 'n' },
        'a string',
        { exclude: 'no run' },
        { run: '  ', note: 'n' },
        { run: 7, note: 'n' },
        { run: 'r', exclude: ' ' },
        { run: 'r', note: 3 },
        { run: 'r' },
        { run: 'r', exclude: '', note: 'a note does not save an empty reason' },
      ]),
    );
    expect(read.status).toBe('read');
    expect(read.entries).toEqual([{ run: 'ok', exclude: null, note: 'n' }]);
    expect(read.problems).toEqual([`${NAME}: ignored 8 invalid entries: runs[1] (not an object), runs[2] (no "run"), runs[3] ("run" is not a non-empty string) and 5 more`]);
  });

  it.each([
    [{ run: 7, note: 'n' }, '"run" is not a non-empty string'],
    [{ run: 'r', exclude: ' ' }, '"exclude" is not a non-empty string'],
    [{ run: 'r', note: 3 }, '"note" is not a non-empty string'],
    [{ run: 'r' }, 'neither "exclude" nor "note"'],
    [null, 'not an object'],
    [['r'], 'not an object'],
  ])('names why an entry is ignored: %j', (entry, why) => {
    expect(parse(file([{ run: 'ok', note: 'n' }, entry])).problems).toEqual([`${NAME}: ignored an invalid entry: runs[1] (${why})`]);
  });

  it('warns about unknown keys of an entry and of the file, with a suggestion, and uses the rest', () => {
    const read = parse(file([{ run: 'a', exlude: 'typo', note: 'kept' }, { run: 'b', note: 'n', test: 'a future key' }], { comment: 'mine' }));
    expect(read.entries).toEqual([
      { run: 'a', exclude: null, note: 'kept' },
      { run: 'b', exclude: null, note: 'n' },
    ]);
    expect(read.problems).toEqual([`${NAME}: ignored 3 unknown keys: "comment", runs[0]."exlude" (did you mean "exclude"?), runs[1]."test"`]);
  });

  it('an entry holding only an unknown key (a later extension) is ignored, with both problems', () => {
    expect(parse(file([{ run: 'a', test: 'x' }])).problems).toEqual([`${NAME}: ignored an invalid entry: runs[0] (neither "exclude" nor "note")`, `${NAME}: ignored an unknown key: runs[0]."test"`]);
  });

  it('masks unknown key names before printing them, then cuts them', () => {
    const read = parse(file([{ run: 'a', note: 'n', [`${SECRET}`]: 1, [`${HOME}/projects/a`]: 2, ['k'.repeat(100)]: 3 }]));
    const [problem] = read.problems;
    expect(problem).not.toContain('s3cret');
    expect(problem).not.toContain('notesuser');
    expect(problem).toBe(`${NAME}: ignored 3 unknown keys: runs[0]."${REDACTED}", runs[0]."~/projects/a", runs[0]."${'k'.repeat(39)}…"`);
  });

  it('a key named __proto__ is an unknown key like any other', () => {
    expect(parse('{ "notesVersion": 1, "runs": [{ "run": "a", "note": "n", "__proto__": { "exclude": "x" } }] }')).toEqual({
      status: 'read',
      entries: [{ run: 'a', exclude: null, note: 'n' }],
      problems: [`${NAME}: ignored an unknown key: runs[0]."__proto__"`],
    });
  });
});

describe('notes file: applied by run', () => {
  it('joins the reasons and the notes of entries for the same run, the same text once', () => {
    const byRun = notesByRun(
      [
        { run: 'a', exclude: 'staging down', note: null },
        { run: 'a', exclude: 'VPN', note: 'first' },
        { run: 'a', exclude: 'staging down', note: 'second' },
        { run: 'b', exclude: null, note: 'only a note' },
      ],
      replay,
    );
    expect(byRun).toEqual(
      new Map([
        ['a', { notesExcluded: 'staging down; VPN', note: 'first; second' }],
        ['b', { note: 'only a note' }],
      ]),
    );
  });

  it('masks a redact.env value and the home directory, here and of other machines', () => {
    const byRun = notesByRun([{ run: 'a', exclude: `token ${SECRET}`, note: `see ${HOME}/logs and C:\\Users\\someone\\logs` }], replay);
    expect(byRun.get('a')).toEqual({ notesExcluded: `token ${REDACTED}`, note: 'see ~/logs and ~\\logs' });
  });

  const across = (max: number) => {
    // The value starts before the cut and ends after it: cut first, its start would stay.
    const start = max - 1 - 6;
    return `${'w'.repeat(start)}${SECRET} after the cut`;
  };

  it.each([
    ['reason', 'exclude' as const, 'notesExcluded' as const, MAX_NOTES_REASON],
    ['note', 'note' as const, 'note' as const, MAX_NOTE],
  ])('masks, then cuts, a %s with a secret across the cut', (_, key, field, max) => {
    const text = across(max);
    // The positive control: cut first, 6 characters of the value stay.
    expect(cutText(text, max)).toContain(SECRET.slice(0, 6));
    const entry = { run: 'a', exclude: null, note: null, [key]: text };
    const kept = notesByRun([entry], replay).get('a')?.[field] ?? '';
    expect(kept.length).toBeLessThanOrEqual(max);
    expect(kept.endsWith('…')).toBe(true);
    for (let length = 3; length <= SECRET.length; length++) expect(kept, kept.slice(-20)).not.toContain(SECRET.slice(0, length));
    // The mask itself may run across the cut: what stays of it is harmless.
    expect(kept).toContain(REDACTED.slice(0, 4));
  });

  it('cuts at 200 and 300 characters, never on half of a surrogate pair', () => {
    const byRun = notesByRun([{ run: 'a', exclude: 'r'.repeat(500), note: 'n'.repeat(500) }], replay).get('a');
    expect([byRun?.notesExcluded?.length, byRun?.note?.length]).toEqual([200, 300]);
    expect(cutText(`${'x'.repeat(8)}😀😀`, 10)).toBe(`${'x'.repeat(8)}…`);
    expect(cutText('short', 10)).toBe('short');
  });
});

describe('notes file: reading', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'loupe-notes-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('off with history.notes: false, without reading', async () => {
    expect(await readNotes(null, dir, mask)).toEqual({ status: 'off', entries: [], problems: [] });
  });

  it('a missing file is absent, with no problem', async () => {
    expect(await readNotes(path.join(dir, 'missing.json'), dir, mask)).toEqual({ status: 'absent', entries: [], problems: [] });
  });

  it('reads a file and names it relative to the working directory', async () => {
    const notes = path.join(dir, 'sub', NAME);
    mkdirSync(path.dirname(notes), { recursive: true });
    writeFileSync(notes, '{ "notesVersion": 1, "runs": [{ "run": "a", "note": "n" }, { "note": "no run" }] }');
    expect(await readNotes(notes, dir, mask)).toEqual({
      status: 'read',
      entries: [{ run: 'a', exclude: null, note: 'n' }],
      problems: [`${path.join('sub', NAME)}: ignored an invalid entry: runs[1] (no "run")`],
    });
  });

  it('a folder in its place, or a file above 1 MB, is invalid, never read', async () => {
    const folder = path.join(dir, 'folder.json');
    mkdirSync(folder);
    expect(await readNotes(folder, dir, mask)).toEqual({ status: 'invalid', entries: [], problems: ['folder.json could not be read, so its entries are ignored (it is not a file)'] });
    const big = path.join(dir, 'big.json');
    writeFileSync(big, `{ "notesVersion": 1, "runs": [], "pad": "${'x'.repeat(MAX_NOTES_BYTES)}" }`);
    expect(await readNotes(big, dir, mask)).toEqual({ status: 'invalid', entries: [], problems: ['big.json could not be read, so its entries are ignored (it is larger than 1 MB)'] });
  });

  it('just under 1 MB is read', async () => {
    const file = path.join(dir, 'large.json');
    const shell = '{ "notesVersion": 1, "runs": [], "pad": "" }';
    writeFileSync(file, shell.replace('""', `"${'x'.repeat(MAX_NOTES_BYTES - shell.length)}"`));
    expect((await readNotes(file, dir, mask)).status).toBe('read');
  });
});

describe('notes file: where the report says it is', () => {
  const base = '/work/project/e2e';
  const at = (file: string | null, folder = base) => notesPath(file, folder, mask);

  it('relative to the Playwright config folder: the default, a subfolder, a folder above it', () => {
    expect(at(path.join(base, NAME))).toBe(NAME);
    expect(at(path.join(base, 'config/notes.json'))).toBe('config/notes.json');
    expect(at('/work/project/shared/loupe.notes.json')).toBe('../shared/loupe.notes.json');
    expect(at('/work/project/loupe.notes.json')).toBe('../loupe.notes.json');
  });

  it('null with history.notes: false', () => {
    expect(at(null)).toBeNull();
  });

  it('never absolute: the bare name for another Windows drive or the folder itself; / separators on Windows', () => {
    const win = (file: string) => notesPath(file, 'C:\\work\\project', mask, path.win32);
    expect(win('D:\\notes\\loupe.notes.json')).toBe(NAME);
    expect(win('C:\\work\\project\\config\\notes.json')).toBe('config/notes.json');
    expect(win('C:\\work\\shared\\loupe.notes.json')).toBe('../shared/loupe.notes.json');
    expect(at(base)).toBe('e2e');
  });

  it('a path climbing out through a home directory or a redact.env value: the bare name, never the home or the value', () => {
    // A home of this machine, of another machine (CI runner), and a secret in a folder name.
    for (const file of [`${HOME}/notes/loupe.notes.json`, '/home/runner/loupe.notes.json', `/srv/${SECRET}/loupe.notes.json`]) {
      const shown = at(file, '/builds/project');
      expect(shown, file).toBe(NAME);
    }
    const win = notesPath('C:\\Users\\someone\\loupe.notes.json', 'C:\\builds\\project', mask, path.win32);
    expect(win).toBe(NAME);
  });

  it('a path inside the folder is shown, masked: a redact.env value never appears', () => {
    const shown = at(path.join(base, `notes-${SECRET}`, NAME));
    expect(shown).not.toContain(SECRET);
    expect(shown).toMatch(/^notes-.+\/loupe\.notes\.json$/);
    // A climbing path with nothing to hide stays as written.
    expect(at('/work/elsewhere/loupe.notes.json')).toBe('../../elsewhere/loupe.notes.json');
  });
});
