// Writes the renderer's dev sample (src/renderer/dev/sample.json) from a real
// run of the fixture suite, so the Vite dev server runs on schema v1 data.
//
// The run uses fixtures/sample.config.ts (the main suite plus an intentional
// global teardown failure) and `--grep-invert` (which also skips the slow
// test), so the sample covers what the renderer must show: failed, flaky and
// skipped tests, a partial run and a run error. The script checks that before
// writing. Absolute paths of this machine (in stack traces) are replaced by `<root>/`.
// The attachment files are copied to src/renderer/dev/data/ (gitignored: videos
// and traces would bloat the repository), where the dev server serves them at
// `data/`, so attachment links work in the dev server too.
// Expects a built reporter (`npm run sample:update` builds first).

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const outputFolder = fileURLToPath(new URL('../loupe-report-sample/', import.meta.url));
const source = `${outputFolder}report.json`;
const target = new URL('../src/renderer/dev/sample.json', import.meta.url);
const dataTarget = fileURLToPath(new URL('../src/renderer/dev/data/', import.meta.url));

rmSync(outputFolder, { recursive: true, force: true });

const { status } = spawnSync(
  'npx',
  ['playwright', 'test', '--config', 'fixtures/sample.config.ts', '--grep-invert', 'is slow'],
  { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, LOUPE_FIXTURE_OUTPUT: outputFolder } },
);

if (!existsSync(source)) {
  console.error(`\nupdate-sample: no report at ${source} (Playwright exit code ${status}).`);
  process.exit(1);
}

const report = JSON.parse(readFileSync(source, 'utf8'));
const problems = [];
if (report.schemaVersion !== 1) problems.push(`schemaVersion is ${report.schemaVersion}, expected 1`);
for (const expected of ['passed', 'failed', 'flaky', 'skipped']) {
  if (!report.tests.some((test) => test.outcome === expected)) problems.push(`no ${expected} test`);
}
if (report.run.scope !== 'partial') problems.push(`run scope is ${report.run.scope}, expected partial`);
if (report.run.errors.length === 0) problems.push('no run error');

if (problems.length > 0) {
  console.error(`\nupdate-sample: unexpected outcome:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}

const json = JSON.stringify(report, null, 2).replaceAll(JSON.stringify(root).slice(1, -1), '<root>/');
writeFileSync(target, `${json}\n`);
rmSync(dataTarget, { recursive: true, force: true });
if (existsSync(`${outputFolder}data`)) cpSync(`${outputFolder}data`, dataTarget, { recursive: true });
console.log(`\nupdate-sample: wrote ${fileURLToPath(target)} (${report.tests.length} tests, ${report.run.errors.length} run error) and its attachments.`);
