// Runs the commands of commands.json in each shell, with --list appended, and checks
// that each selects exactly the expected tests. Nothing else runs; no browser is needed.
//
//   node check.mjs                        REQUIRED commands, in every shell found
//   node check.mjs --measure              also the "measure" rows, which never fail the run
//   node check.mjs --shell=cmd.exe        one shell, a name as printed
//   node check.mjs --require-all-shells   fails if a shell is missing, instead of skipping it
//
// Exit code 1 when a REQUIRED command selects anything else, or when none ran.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

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

function once(shell, text, cacheDir) {
  return new Promise((resolve) => {
    const [command, args, options] = shell.run(`${text} --list`);
    const child = spawn(command, args, { ...options, env: { ...process.env, PWTEST_CACHE_DIR: cacheDir } });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('error', (error) => resolve({ missing: true, raw: String(error) }));
    child.on('close', () => {
      const line = output.split(/\r?\n/).find((candidate) => candidate.startsWith('LOUPE_SELECTION '));
      resolve(line ? { selected: JSON.parse(line.slice('LOUPE_SELECTION '.length)).map((parts) => JSON.stringify(parts)) } : { raw: output.slice(0, 400) });
    });
  });
}

const report = [];
let failed = 0;
let requiredRun = 0;
const started = Date.now();
for (const shell of SHELLS.filter((candidate) => !onlyShell || candidate.name === onlyShell)) {
  const shellStarted = Date.now();
  const probeDir = mkdtempSync(path.join(tmpdir(), 'loupe-'));
  const probe = await once(shell, commands[0].text, probeDir);
  rmSync(probeDir, { recursive: true, force: true });
  if (probe.missing) {
    console.log(`\n=== ${shell.name}: not installed${requireAllShells ? '' : ', skipped'}`);
    if (requireAllShells) failed += 1;
    continue;
  }
  console.log(`\n=== ${shell.name}: ${commands.length} commands`);
  const stats = {};
  const queue = [...commands];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      const cacheDir = mkdtempSync(path.join(tmpdir(), 'loupe-'));
      for (let item = queue.shift(); item; item = queue.shift()) {
        const { selected, raw } = await once(shell, item.text, cacheDir);
        const stat = (stats[item.form] ??= { required: item.required, ok: 0, bad: [] });
        // A dependency project selected for a project asked is expected.
        const asked = new Set(item.expected.map((key) => JSON.parse(key)[0]));
        const kept = selected?.filter((key) => asked.has(JSON.parse(key)[0]) || JSON.parse(key)[0] !== 'setup');
        if (kept && kept.length === item.expected.length && item.expected.every((key) => kept.includes(key))) stat.ok += 1;
        else stat.bad.push({ length: item.text.length, command: item.text.slice(0, 300), expected: item.expected.length, selected: kept ? kept.length : 'error', raw });
      }
      rmSync(cacheDir, { recursive: true, force: true });
    }),
  );
  for (const [form, stat] of Object.entries(stats)) {
    if (stat.required) {
      failed += stat.bad.length;
      requiredRun += stat.ok + stat.bad.length;
    }
    console.log(`${stat.required ? 'REQUIRED' : 'measure '}  ${form.padEnd(48)} ok ${String(stat.ok).padStart(3)}  bad ${stat.bad.length}`);
    for (const bad of stat.bad.slice(0, 3)) {
      console.log(`    ${bad.command}\n    -> length ${bad.length}, selected ${bad.selected} of ${bad.expected}${bad.raw ? `: ${bad.raw.slice(0, 200).replace(/\s+/g, ' ')}` : ''}`);
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
