// Runs the fixture suite, which fails on purpose (see fixtures/README.md).
//
// Playwright exits with code 1 for test failures but also for config or
// reporter errors, so the exit code alone cannot tell "intended failures" from
// "broken pipeline". This script accepts exit code 1 only when the Loupe
// reporter wrote a fresh report in which:
//   - passed, failed, flaky and skipped tests are all present;
//   - every failed or flaky test is marked "(intentional)" in its title.
// Anything else (no report, unexpected pass, a test failing for another reason
// such as a missing browser) exits with an error.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const reportDir = fileURLToPath(new URL('../loupe-report/', import.meta.url));
const reportFile = `${reportDir}report.json`;

rmSync(reportDir, { recursive: true, force: true });

const { status } = spawnSync('npx', ['playwright', 'test', '--config', 'fixtures/playwright.config.ts'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (!existsSync(reportFile)) {
  console.error(`\nrun-fixtures: no report at ${reportFile} (Playwright exit code ${status}).`);
  process.exit(status || 1);
}

const report = JSON.parse(readFileSync(reportFile, 'utf8'));
const problems = [];

if (status !== 1) problems.push(`Playwright exit code is ${status}, expected 1`);
for (const expected of ['passed', 'failed', 'flaky', 'skipped']) {
  if (!report.tests.some((test) => test.status === expected)) problems.push(`no ${expected} test`);
}
for (const test of report.tests) {
  const title = test.titlePath.at(-1) ?? '';
  if ((test.status === 'failed' || test.status === 'flaky') && !title.includes('(intentional)')) {
    problems.push(`unexpected ${test.status} test: [${test.project}] ${test.titlePath.join(' > ')}`);
  }
}

if (problems.length > 0) {
  console.error(`\nrun-fixtures: unexpected outcome (see fixtures/README.md):\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}

console.log('\nrun-fixtures: the fixture suite failed as intended.');
