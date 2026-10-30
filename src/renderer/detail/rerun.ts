import type { TestCase } from '../../schema/v1.js';

/**
 * Rerun commands, to paste from the Playwright root directory in bash, zsh,
 * PowerShell, cmd.exe or Git Bash:
 *
 *   npx playwright test tests.login.spec.ts --project=chromium -g "^ *chromium tests.login.spec.ts logs in$"
 *
 * Tests are selected by title, never by line: the line Playwright records can
 * be a line of the compiled file (see "Known Playwright issues" in
 * docs/support.md). One command covers every test, however many there are: a
 * single test is a group of one, and shared prefixes are written once.
 *
 * What `-g` matches, from Playwright 1.52: `<project> <file> <describe>
 * <title>`, joined with spaces, the tags declared with `{ tag }` right after
 * the file (a describe without a title), the describe or the title they belong
 * to, and an unnamed project leaving one leading space. Hence `^ *`. Tests the
 * string cannot tell apart run together: titles differing only by case (`-g`
 * ignores it, and its `/.../` form is rewritten as a path by Git Bash),
 * `a › b` and `a b`, an inline tag and the same `{ tag }`.
 *
 * Commands are ASCII, and the text inside their double quotes has nothing a
 * shell acts on: backslashes only come before a letter or a regex
 * metacharacter, and the only `$` is the one before the last closing quote.
 *
 * Pure functions, no DOM: unit-tested in Node.
 */

export type RerunTarget = Pick<TestCase, 'file' | 'project' | 'suitePath' | 'title' | 'tags'>;

/** Above this many tests, the command is long enough to deserve a notice. */
export const LONG_COMMAND_TESTS = 100;

/** Above this length, a command may not fit the Windows limits (8,191 characters in cmd.exe). */
export const WINDOWS_COMMAND_LENGTH = 8000;

/** Above this length, a command cannot run on Linux: it is the limit of a single argument, and `-g` is one. */
export const LINUX_COMMAND_LENGTH = 131072;

/** The limit a command is above, if any. Commands are ASCII: their length is their size in bytes. */
export function commandLimit(command: string): 'windows' | 'linux' | null {
  if (command.length > LINUX_COMMAND_LENGTH) return 'linux';
  return command.length > WINDOWS_COMMAND_LENGTH ? 'windows' : null;
}

/** Left unquoted: letters, digits and `_@%+=:,./-`. */
const SAFE = /^[\w@%+=:,./-]+$/;

/** An argument for a POSIX shell: as is when safe, single-quoted otherwise. */
export function shellQuote(value: string): string {
  if (SAFE.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Inert in every shell and in a regular expression. */
const LITERAL = /[A-Za-z0-9 _:@,=~#'-]/;

/** Inert in every shell between double quotes, once escaped for the regular expression. */
const REGEX_METACHARACTER = /[.*+?()[\]{}]/;

/**
 * `text` as a regular expression matching exactly it: the other characters
 * become hexadecimal escapes, by UTF-16 code unit since `-g` has no `u` flag.
 * Non-ASCII letters too, until the Windows shells are known to pass them intact.
 */
function regexText(text: string): string {
  let result = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    const code = text.charCodeAt(index);
    if (LITERAL.test(char)) result += char;
    else if (REGEX_METACHARACTER.test(char)) result += `\\${char}`;
    else if (code < 0x80) result += `\\x${code.toString(16).padStart(2, '0')}`;
    else result += `\\u${code.toString(16).padStart(4, '0')}`;
  }
  return result;
}

/** `-g` sees backslashes on Windows, hence `.` for a separator; dots stay as they are, for a readable file name. */
function fileText(file: string): string {
  return file.split('/').map((part) => regexText(part).replace(/\\\./g, '.')).join('.');
}

/** Bare when only made of these: nothing to act on in any shell. In double quotes otherwise. */
const PLAIN = /^[\w.-]+$/;

/**
 * The positional argument, a regular expression on the absolute path of the
 * file, which limits what Playwright loads. It has the text of `-g`, so the
 * same escaping; a leading `-` would read as an option.
 */
function fileArgument(file: string): string {
  const pattern = fileText(file).replace(/^-/, '.');
  return PLAIN.test(pattern) ? pattern : `"${pattern}"`;
}

/**
 * `--project`, which takes a name, not a regular expression: `\\x24` would be
 * looked up as is. It matches ignoring case and takes `*` as a wildcard, so a
 * character unsafe in a shell becomes `*`, and `-g` gives the exact project.
 * A dot is quoted too: Windows PowerShell can split an unquoted argument
 * starting with a dash at a dot.
 */
function projectFlag(project: string): string {
  const name = project.replace(/["$`%!\\^&|<>]|[^\x20-\x7e]/g, '*');
  return PLAIN.test(name) && !name.includes('.') ? `--project=${name}` : `"--project=${name}"`;
}

/** Between two segments of the `-g` string: the tags of a `{ tag }`, which the model does not locate. */
const TAGS = '( @\\S+)*';

/** The segments of a test in the `-g` string, after its project. A test with `{ tag }` tags tolerates them after each one. */
function segments(test: RerunTarget): string[] {
  // Every tag found in the titles is an inline one: more tags than that means `{ tag }`.
  const inline = [...test.suitePath, test.title].join(' ').match(/@\S+/g)?.length ?? 0;
  const tags = test.tags.length > inline ? TAGS : '';
  return [fileText(test.file), ...test.suitePath.map(regexText), regexText(test.title)].map((segment) => segment + tags);
}

interface PrefixNode {
  /** A test ends here, on top of those going on through `children`. */
  leaf: boolean;
  children: Map<string, PrefixNode>;
}

function group(alternatives: readonly string[]): string {
  return alternatives.length === 1 ? (alternatives[0] ?? '') : `(${alternatives.join('|')})`;
}

/** What follows a node, shared prefixes written once, in text order: the result depends on nothing but the titles. */
function alternativesOf(node: PrefixNode): string {
  const alternatives: string[] = [];
  for (const [segment, child] of [...node.children].sort(([a], [b]) => compareText(a, b))) {
    if (child.leaf) alternatives.push(segment);
    if (child.children.size > 0) alternatives.push(`${segment} ${alternativesOf(child)}`);
  }
  return group(alternatives);
}

function childOf(children: Map<string, PrefixNode>, key: string): PrefixNode {
  const existing = children.get(key);
  if (existing) return existing;
  const created: PrefixNode = { leaf: false, children: new Map() };
  children.set(key, created);
  return created;
}

/** The `-g` pattern selecting `tests`. Projects share their alternatives only when the text is the same, so the selection is too. */
function grepPattern(tests: readonly RerunTarget[]): string {
  const roots = new Map<string, PrefixNode>();
  for (const test of tests) {
    let node = childOf(roots, test.project);
    for (const segment of segments(test)) node = childOf(node.children, segment);
    node.leaf = true;
  }
  const projectsByTests = new Map<string, string[]>();
  for (const [project, root] of roots) {
    // An unnamed project has no segment to share.
    if (project === '') continue;
    const key = alternativesOf(root);
    projectsByTests.set(key, [...(projectsByTests.get(key) ?? []), project]);
  }
  const alternatives = [...projectsByTests].map(([key, projects]) => `${group(projects.map(regexText))} ${key}`);
  const unnamed = roots.get('');
  if (unnamed) alternatives.push(alternativesOf(unnamed));
  return `^ *${group(alternatives)}$`;
}

/**
 * The command rerunning `tests`, projects in order of first appearance, files
 * sorted. `--project` is left out when a test has no project name: no flag can
 * select it, and `-g` gives the exact project. Empty when there is no test.
 */
export function rerunCommand(tests: readonly RerunTarget[]): string {
  if (tests.length === 0) return '';
  const files = [...new Set(tests.map((test) => fileArgument(test.file)))].sort(compareText);
  const projects = [...new Set(tests.map((test) => test.project))];
  const flags = projects.includes('') ? [] : projects.map(projectFlag);
  return ['npx playwright test', ...files, ...flags, '-g', `"${grepPattern(tests)}"`].join(' ');
}

/** The distinct `file:line` locations of each project, sorted by file then line; projects in order of first appearance. */
export function locationsByProject(tests: readonly Pick<TestCase, 'file' | 'line' | 'project'>[]): Map<string, string[]> {
  const byProject = new Map<string, Map<string, Pick<TestCase, 'file' | 'line'>>>();
  for (const test of tests) {
    let locations = byProject.get(test.project);
    if (!locations) {
      locations = new Map();
      byProject.set(test.project, locations);
    }
    locations.set(`${test.file}:${test.line}`, test);
  }
  return new Map(
    [...byProject].map(([project, locations]) => [
      project,
      [...locations.values()].sort((a, b) => compareText(a.file, b.file) || a.line - b.line).map((test) => `${test.file}:${test.line}`),
    ]),
  );
}

/** Tests that finally failed; flaky tests passed on a retry and are left out. */
export function failedTests<T extends Pick<TestCase, 'outcome'>>(tests: readonly T[]): T[] {
  return tests.filter((test) => test.outcome === 'failed');
}

/** The failed tests of the run declared in the same file as `test`, every project included. */
export function failedTestsInFile<T extends Pick<TestCase, 'outcome' | 'file'>>(tests: readonly T[], file: string): T[] {
  return failedTests(tests).filter((test) => test.file === file);
}

/**
 * The "failed tests in this file" rerun of a test detail: the failed tests of
 * its file, every project included. Null unless the file has a failed test
 * at another line than `test`: the same test failing in several projects is
 * not "other failed tests".
 */
export function fileRerun<T extends Pick<TestCase, 'file' | 'line' | 'project' | 'outcome'>>(
  tests: readonly T[],
  test: Pick<TestCase, 'file' | 'line'>,
): { tests: T[]; label: string } | null {
  const inFile = failedTestsInFile(tests, test.file);
  if (!inFile.some((other) => other.line !== test.line)) return null;
  const counts = [...locationsByProject(inFile)].map(([project, locations]) => ({ project: project || '(unnamed project)', count: locations.length }));
  const noun = (count: number): string => (count === 1 ? 'failed test' : 'failed tests');
  const [first] = counts;
  if (counts.length === 1 && first) return { tests: inFile, label: `${first.count} ${noun(first.count)} in this file` };
  if (first && counts.every(({ count }) => count === first.count)) {
    return { tests: inFile, label: `${first.count} ${noun(first.count)} in this file, in ${counts.map(({ project }) => project).join(', ')}` };
  }
  return { tests: inFile, label: `failed tests in this file: ${counts.map(({ project, count }) => `${count} in ${project}`).join(', ')}` };
}

/** Help text of every rerun button. */
export const RERUN_HELP =
  'For a POSIX shell (bash, zsh), run from the Playwright root directory: paths are relative to it. A file:line argument targets the line where the test is declared, and reruns every test declared on that line. The command is only valid while the file has not changed since the run.';
