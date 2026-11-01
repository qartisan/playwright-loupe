// Builds the Windows check of the rerun commands in `<folder>/loupe-windows-check`, from
// fixtures/rerun/ and the real command builder: a report written by Loupe with --list, then
// src/renderer/detail/rerun.ts. Needs `npm run build`. CI runs the result on windows-latest
// (.github/workflows/windows-check.yml); with --pack, it is also the archive for a manual run.
//
//   node fixtures/windows-check/build.mjs <folder outside the repository> [--pack <file.tgz>]
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEFT_OUT_FILE, leftOutNotice } from './harness.mjs';

// The repository's sources import `./x.js` for `./x.ts`.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL?.endsWith('.ts')) {
      return next(`${specifier.slice(0, -'.js'.length)}.ts`, context);
    }
    return next(specifier, context);
  },
});

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const args = process.argv.slice(2);
const packIndex = args.indexOf('--pack');
const pack = packIndex === -1 ? null : path.resolve(args[packIndex + 1] ?? '');
const parent = args[0] && args[0] !== '--pack' ? path.resolve(args[0]) : null;
if (!parent) throw new Error('Usage: node fixtures/windows-check/build.mjs <folder outside the repository> [--pack <file.tgz>]');
// It installs dependencies and deletes the folder: never in the repository. On another Windows drive, the relative path is absolute.
const relative = path.relative(repo, parent);
if (!relative.startsWith('..') && !path.isAbsolute(relative)) throw new Error(`Refusing to build inside the repository: ${parent}`);
mkdirSync(parent, { recursive: true });
const reporter = path.join(repo, 'dist', 'index.js');
if (!existsSync(reporter)) throw new Error('Run `npm run build` first.');

const stage = path.join(parent, 'loupe-windows-check');
const reportDir = path.join(parent, 'report');
rmSync(stage, { recursive: true, force: true });
rmSync(reportDir, { recursive: true, force: true });
mkdirSync(stage);

function run(command, commandArgs, env = {}) {
  const result = spawnSync(command, commandArgs, { cwd: stage, encoding: 'utf8', shell: process.platform === 'win32', env: { ...process.env, ...env } });
  if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(' ')}: exit code ${result.status}\n${result.stdout}\n${result.stderr}`);
}

// Sources. The hostile files come from setup.mjs: see there.
cpSync(path.join(repo, 'fixtures', 'rerun'), path.join(stage, 'rerun'), { recursive: true, filter: (source) => path.basename(source) !== 'hostile' });
cpSync(path.join(repo, 'fixtures', 'redaction-values.ts'), path.join(stage, 'redaction-values.ts'));
cpSync(path.join(here, 'long.spec.ts'), path.join(stage, 'rerun', 'long.spec.ts'));
for (const file of ['check.mjs', 'harness.mjs', 'setup.mjs', 'playwright.config.cjs', 'selection-reporter.cjs']) cpSync(path.join(here, file), path.join(stage, file));
cpSync(path.join(here, 'kit-README.txt'), path.join(stage, 'README.txt'));
const { version } = JSON.parse(readFileSync(path.join(repo, 'node_modules', '@playwright', 'test', 'package.json'), 'utf8'));
// No `type`: CommonJS, which a `%` in a file name needs (see setup.mjs).
writeFileSync(path.join(stage, 'package.json'), `${JSON.stringify({ name: 'loupe-windows-check', private: true, devDependencies: { '@playwright/test': version } }, null, 2)}\n`);

const { WINDOWS_LINE_LENGTH, commandLimit, rerunCommand, windowsLineLength } = await import('../../src/renderer/detail/rerun.ts');
const { expectedFor } = await import('../helpers/rerun-expected.ts');

// Titles giving a line of a chosen length for windowsLineLength, at most: just under its limit they
// must pass, so every run checks the calibration; above it, the measure rows show where the limit is.
const calibrationCommand = (title) => rerunCommand([{ file: 'calibration.spec.ts', project: 'main', suitePath: [], title, tags: [] }]);
function titleForLine(target, make) {
  let count = 1;
  while (windowsLineLength(calibrationCommand(make(count + 1))) <= target) count += 1;
  return make(count);
}
const denseTitle = (count) => `dense ${'word '.repeat(count)}end`;
const plainTitle = (count) => `plain ${'x'.repeat(count)}`;
const calibration = [
  { form: 'calibration, dense, just under the limit', title: titleForLine(WINDOWS_LINE_LENGTH, denseTitle), required: true },
  { form: 'calibration, plain, just under the limit', title: titleForLine(WINDOWS_LINE_LENGTH, plainTitle), required: true },
  ...[10, 20, 30, 40, 60, 100].map((above) => ({ form: `calibration, dense, ${above} above the limit`, title: titleForLine(WINDOWS_LINE_LENGTH + above, denseTitle), required: false })),
  ...[50, 100, 150, 200, 250, 300, 350, 400].map((above) => ({ form: `calibration, plain, ${above} above the limit`, title: titleForLine(WINDOWS_LINE_LENGTH + above, plainTitle), required: false })),
];
writeFileSync(
  path.join(stage, 'rerun', 'calibration.spec.ts'),
  `import { test } from '@playwright/test';\n\nfor (const title of ${JSON.stringify(calibration.map(({ title }) => title))}) test(title, async () => {});\n`,
);

run('npm', ['install', '--no-audit', '--no-fund', '--silent']);
run('node', ['setup.mjs']);
run('npx', ['playwright', 'test', '--list'], { KIT_LOUPE: reporter, KIT_LOUPE_OUTPUT: reportDir });

const report = JSON.parse(readFileSync(path.join(reportDir, 'report.json'), 'utf8'));

const commands = [];
// An archive runs on another machine: the paths in the titles of paths-in-titles.spec.ts are those of this one, and its commands find nothing there.
const runsHere = (test) => !pack || test.file !== 'paths-in-titles.spec.ts';
let rowsLeftOut = 0;
function add(form, list, text, required) {
  const tests = list.filter(runsHere);
  if (tests.length === 0) {
    rowsLeftOut += 1;
    return;
  }
  const command = text ?? rerunCommand(tests);
  commands.push({ form, required: required ?? commandLimit(command) === null, expected: [...new Set(tests.flatMap(expectedFor))], text: command });
}
const tests = report.tests.filter((test) => test.file !== 'long.spec.ts' && test.file !== 'calibration.spec.ts');
const inLong = report.tests.filter((test) => test.file === 'long.spec.ts' && test.project === 'main');
const longs = inLong.filter((test) => test.title.startsWith('long '));
const dense = inLong.filter((test) => test.title.startsWith('dense '));
const find = (project, title, file = 'plain.spec.ts') => {
  const test = tests.find((candidate) => candidate.project === project && candidate.title === title && candidate.file === file);
  if (!test) throw new Error(`No test "${title}" in ${file} of ${project}`);
  return test;
};

// Commands are ASCII but for letters and marks left literal: their own rows, REQUIRED like the others.
const lettersIn = (text) => /[^\x00-\x7f]/.test(text);
for (const test of tests) add(lettersIn(rerunCommand([test])) ? 'one test, literal letters' : 'one test', [test]);
// `--list` without --project leaves this project out of the report.
add('one test', [{ ...find('main', 'alpha'), project: 'off-by-default' }]);

const notLong = tests.filter((test) => [...test.suitePath, test.title].join('').length < 200);
const groupsBy = (key) => [...Map.groupBy(notLong, key).values()];
for (const list of groupsBy((test) => test.file)) add('many tests, one file', list);
for (const list of groupsBy((test) => test.project)) add('many tests, one project', list);
add('many tests, different sets per project', [find('main', 'alpha'), find('other', 'beta')]);
add('many tests, one set contains the other', [find('main', 'alpha'), find('main', 'beta'), find('other', 'alpha')]);
add('many tests, same set in two projects', [find('main', 'alpha'), find('main', 'beta'), find('other', 'alpha'), find('other', 'beta')]);
add('many tests, hostile projects and paths', [
  find('v1.2', 'alpha'),
  find('star*name', 'alpha'),
  find('/opt/proj', 'alpha'),
  find('Mobile (iOS) + x', 'beta'),
  find('Sécu "q" $x %y% `z` !', 'alpha'),
  ...tests.filter((test) => test.file.startsWith('hostile/') && test.project === 'main'),
]);

// A command the notice says nothing about must work; above its limit, a measure. The length of the line is in the name.
const lengthRows = (name, list) => {
  const text = rerunCommand(list);
  add(`${name}, length about ${Math.round(text.length / 1000)},000, line ${windowsLineLength(text)}`, list, text);
};
for (const count of [7, 9, 12, 20, 33, 36]) lengthRows('plain', longs.slice(0, count));
for (const count of [3, 4, 5, 6, 7, 8]) lengthRows('dense', dense.slice(0, count));
for (const { form, title, required } of calibration) {
  const test = report.tests.find((candidate) => candidate.file === 'calibration.spec.ts' && candidate.project === 'main' && candidate.title === title);
  const text = rerunCommand([test]);
  add(`${form}, line ${windowsLineLength(text)}`, [test], text, required);
}
writeFileSync(path.join(stage, 'commands.json'), JSON.stringify(commands, null, 1));

const pick = (fragments, form = 'one test') => {
  const found = commands.find((command) => command.form === form && fragments.every((fragment) => command.text.includes(fragment)));
  if (!found) throw new Error(`No command with ${fragments.join(', ')}`);
  return found;
};
const manual = [
  ['A plain test', pick(['plain.spec.ts', '--project=main', ' alpha$'])],
  ['The non-ASCII file name, full of shell characters', pick(['in a path with shell characters', '--project=main'], 'one test, literal letters')],
  ['A percent sign in a file name', pick(['in a path with a percent sign', '--project=main'])],
  ['Regex characters and a space in a path', pick(['in a path with regex characters', '--project=main'])],
  ['Accented letters left literal, in a title', pick(['accents éàü', '--project=main'], 'one test, literal letters')],
  ['Letters left literal, in a project name', pick(['"--project=Sécu', ' alpha$'], 'one test, literal letters')],
  ['The v1.2 project, quoted', pick(['"--project=v1.2"', ' alpha$'])],
  ['A project starting with a slash, which Git Bash would rewrite', pick(['"--project=*opt*proj"', ' alpha$'])],
  ['A title with every shell character', pick(['caret', '--project=main'])],
  ['Tags from a describe and from the test', pick(['nested', 'three', '--project=main'])],
  ['Several projects, with different tests', pick([], 'many tests, different sets per project')],
];
const notice = leftOutNotice(rowsLeftOut);
if (notice) writeFileSync(path.join(stage, LEFT_OUT_FILE), `${notice}\n`);
const lines = [...(notice ? [`Not the whole check: ${notice}`, ''] : []), 'Paste each command as is, adding " --list" at the end. It must print one line starting with LOUPE_SELECTION and no error. That line has one [project, file, ...titles] entry per test: check the number below.', ''];
for (const [index, [label, command]] of manual.entries()) {
  const count = command.expected.length;
  lines.push(`${index + 1}. ${label}: ${count} test${count > 1 ? 's' : ''}, plus 1 from the "setup" project when the command says --project=main`, command.text, '');
}
writeFileSync(path.join(stage, 'manual-paste.txt'), lines.join('\r\n'));
console.log(`${commands.length} commands, ${commands.filter((command) => command.required).length} required, in ${stage}`);
if (notice) console.log(notice);

if (pack) {
  const packed = spawnSync('tar', ['-czf', pack, '--exclude=node_modules', '--exclude=results.json', '--exclude=rerun/hostile', '-C', parent, 'loupe-windows-check'], { encoding: 'utf8' });
  if (packed.status !== 0) throw new Error(`tar: ${packed.stderr}`);
  console.log(`Archive: ${pack}`);
}
