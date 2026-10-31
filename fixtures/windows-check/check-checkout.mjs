// A fresh checkout on this machine holds every tracked file, under its exact name,
// and git sees no change. Run from the root of the repository, before installing.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const problems = [];
const changed = git('status', '--porcelain');
if (changed !== '') problems.push(`git sees changes after the checkout:\n${changed}`);
const tracked = git('ls-files', '-z').split('\0').filter(Boolean);
for (const file of tracked) if (!existsSync(file)) problems.push(`tracked file missing: ${JSON.stringify(file)}`);
// In NFC, as committed: \u00e9, not e and a combining accent.
const hostile = "$a !c &d 'e' ^f `g` \u00e9.spec.ts";
const names = readdirSync('fixtures/rerun/hostile/[id]/(group)');
if (!names.includes(hostile)) problems.push(`no file named ${JSON.stringify(hostile)}, only ${JSON.stringify(names)}`);

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`Checkout clean: ${tracked.length} tracked files, the non-ASCII file name intact.`);
