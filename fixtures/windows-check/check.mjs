// Runs the commands of commands.json in each shell, with --list appended, and checks
// that each selects exactly the expected tests. Nothing else runs; no browser is needed.
//
//   node check.mjs                        REQUIRED commands, in every shell found
//   node check.mjs --measure              also the "measure" rows, which never fail the run
//   node check.mjs --shell=cmd.exe        one shell, a name as printed
//   node check.mjs --require-all-shells   fails if a shell is missing, instead of skipping it
//
// Exit code 1 when a REQUIRED command selects anything else or cannot start, or when none ran.
// PowerShell gets its commands through -EncodedCommand, 2.67 times longer: a measure row
// refused there above about 12,000 characters says nothing about a pasted command.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { countRequired, describeBad, runCommand, runRows } from './harness.mjs';

const flag = (name) => process.argv.includes(`--${name}`);
const onlyShell = process.argv.find((arg) => arg.startsWith('--shell='))?.slice('--shell='.length);
const measure = flag('measure');
const requireAllShells = flag('require-all-shells');
const commands = JSON.parse(readFileSync('commands.json', 'utf8')).filter((command) => measure || command.required);
if (!existsSync(path.join('rerun', 'hostile'))) {
  console.error('Run `node setup.mjs` first.');
  process.exit(2);
}

const gitBash = ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe'].find((file) => existsSync(file)) ?? 'git-bash-not-found';
const encoded = (text) => Buffer.from(text, 'utf16le').toString('base64');
const powershell = (executable, name, viaCmd) => ({
  name,
  run: (text) => [executable, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded(viaCmd ? text.replace(/^npx /, 'npx.cmd ') : text)], {}],
});
const SHELLS =
  process.platform === 'win32'
    ? [
        { name: 'cmd.exe', run: (text) => ['cmd.exe', ['/d', '/s', '/c', `"${text}"`], { windowsVerbatimArguments: true }] },
        powershell('powershell.exe', 'PowerShell 5.1', false),
        powershell('powershell.exe', 'PowerShell 5.1 npx.cmd', true),
        powershell('pwsh.exe', 'PowerShell 7', false),
        powershell('pwsh.exe', 'PowerShell 7 npx.cmd', true),
        { name: 'Git Bash', run: (text) => [gitBash, ['-c', text], {}] },
      ]
    : [
        { name: 'bash', run: (text) => ['bash', ['-c', text], {}] },
        { name: 'zsh', run: (text) => ['zsh', ['-c', text], {}] },
      ];

const report = [];
let failed = 0;
let requiredRun = 0;
const started = Date.now();
for (const shell of SHELLS.filter((candidate) => !onlyShell || candidate.name === onlyShell)) {
  const shellStarted = Date.now();
  const worker = () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), 'loupe-'));
    return { env: { PWTEST_CACHE_DIR: cacheDir }, dispose: () => rmSync(cacheDir, { recursive: true, force: true }) };
  };
  const probeWorker = worker();
  const probe = await runCommand(shell.run(`${commands[0].text} --list`), probeWorker.env);
  probeWorker.dispose();
  if (probe.code === 'ENOENT') {
    console.log(`\n=== ${shell.name}: not installed${requireAllShells ? '' : ', skipped'}`);
    if (requireAllShells) failed += 1;
    continue;
  }
  console.log(`\n=== ${shell.name}: ${commands.length} commands`);
  const stats = await runRows({ commands, toLaunch: shell.run, worker });
  const counted = countRequired(stats);
  failed += counted.bad;
  requiredRun += counted.run;
  for (const [form, stat] of Object.entries(stats)) {
    console.log(`${stat.required ? 'REQUIRED' : 'measure '}  ${form.padEnd(48)} ok ${String(stat.ok).padStart(3)}  bad ${stat.bad.length}`);
    // Every measure row is data; a broken REQUIRED form could print a lot.
    for (const bad of stat.required ? stat.bad.slice(0, 3) : stat.bad) {
      console.log(`    ${stat.required ? `${bad.command}\n    -> ` : ''}${describeBad(bad)}`);
    }
  }
  console.log(`${shell.name}: ${Math.round((Date.now() - shellStarted) / 1000)} s`);
  report.push({ shell: shell.name, stats });
}
writeFileSync('results.json', JSON.stringify(report, null, 1));
const minutes = ((Date.now() - started) / 60000).toFixed(1);
if (requiredRun === 0) {
  console.log('\nFAIL: no REQUIRED command ran.');
  process.exit(1);
}
console.log(`\n${failed === 0 ? 'PASS' : `FAIL: ${failed} problem(s) on REQUIRED rows or missing shells`}, in ${minutes} min. Measure rows do not count. Details in results.json.`);
process.exit(failed === 0 ? 0 : 1);
