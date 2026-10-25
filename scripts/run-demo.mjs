// Runs the demo suite (demo/), which fails on purpose (see demo/README.md),
// and checks that the report shows what the live demo is meant to show.
//
// Playwright exits with code 1 for test failures but also for config or
// reporter errors, so the exit code alone cannot tell "intended failures" from
// "broken pipeline". This script accepts exit code 1 only when the Loupe
// reporter wrote a fresh schema v1 report in which:
//   - every test has its intended outcome (the lists below), and nothing else fails;
//   - there is no run error;
//   - skip reasons, "Not run", an error group shared by several tests, the
//     error categories, the dimensions, nested steps and the attachments are there;
//   - the rendered report shows exactly one common failure point, `signIn`;
//   - the report folder stays under the size ceiling of the live demo.
// Anything else exits with an error.
//
// Usage: node scripts/run-demo.mjs [--open]   (`npm run demo` builds first)

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const reportDir = fileURLToPath(new URL('../demo-report/', import.meta.url));
const reportFile = join(reportDir, 'report.json');
const indexFile = join(reportDir, 'index.html');

/** Ceiling of the whole Pages site; the target is 5 MB. */
const MAX_BYTES = 10 * 1024 * 1024;
const TEST_COUNT = { min: 45, max: 55 };

// `<project> › <describe titles> › <title>`. Every test not listed must pass.
const EXPECTED = {
  failed: [
    'web › Catalog › shows prices with the currency symbol first',
    'web › Catalog › shows recently viewed products to a returning customer',
    'web › Catalog › keeps the product card design',
    'web › Cart › with a product › removes a product',
    'web › Cart › with a product › adds shipping to the total',
    'web › Checkout › card payment › pays by card',
    'web › Account › orders › lists the orders of a returning customer',
    'web › Account › orders › downloads an invoice',
    'web › Account › orders › exports the order history',
    'web › Account › opens the staff dashboard',
    'api › Products API › returns the stock of a product',
    'api › Products API › recommends related products',
    'api › Products API › still answers on the legacy search endpoint',
    'api › Cart API › reserves stock for the cart items',
    'api › Orders API › lists the orders of a returning customer',
    'api › Orders API › lets staff see every order',
    'api › Order lifecycle › checks stock before shipping',
  ],
  flaky: ['web › Cart › shows the delivery estimate', 'api › Cart API › estimates the delivery date'],
  skipped: [
    'web › Catalog › product page › shows customer reviews',
    'web › Cart › with a product › applies two discount codes at once',
    'web › Checkout › pays with a wallet',
    'api › Order lifecycle › ships the order',
    'api › Order lifecycle › sends the delivery notification',
  ],
};

const CATEGORIES = [
  'Payment provider',
  'Visual regression',
  'Ambiguous locator',
  'Locator not found',
  'Rate limited',
  'Server error',
  'Network',
  'Assertion',
  'Timeout',
  'Uncategorized',
];
const DIMENSIONS = ['Area', 'Owner', 'Bug', 'layer'];
const FAILURE_POINT = 'signIn';

rmSync(reportDir, { recursive: true, force: true });

const { status } = spawnSync('npx', ['playwright', 'test', '--config', 'demo/playwright.config.ts'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (!existsSync(reportFile) || !existsSync(indexFile)) {
  console.error(`\nrun-demo: no report in ${reportDir} (Playwright exit code ${status}).`);
  process.exit(status || 1);
}

const report = JSON.parse(readFileSync(reportFile, 'utf8'));
const problems = [];
const check = (condition, problem) => {
  if (!condition) problems.push(problem);
};

const name = (test) => [test.project, ...test.suitePath, test.title].join(' › ');
const isFailing = (attempt) => attempt.status === 'failed' || attempt.status === 'timedOut' || attempt.status === 'interrupted';

check(status === 1, `Playwright exit code is ${status}, expected 1`);
check(report.schemaVersion === 1, `schemaVersion is ${report.schemaVersion}, expected 1`);
for (const error of report.run.errors) problems.push(`unexpected run error: ${error.message.split('\n')[0]}`);
check(
  report.tests.length >= TEST_COUNT.min && report.tests.length <= TEST_COUNT.max,
  `${report.tests.length} tests, expected ${TEST_COUNT.min} to ${TEST_COUNT.max}`,
);

// Outcomes.
const expectedOutcome = new Map(Object.entries(EXPECTED).flatMap(([outcome, names]) => names.map((test) => [test, outcome])));
const seen = new Set(report.tests.map(name));
for (const test of report.tests) {
  const expected = expectedOutcome.get(name(test)) ?? 'passed';
  check(test.outcome === expected, `${name(test)}: ${test.outcome}, expected ${expected}`);
}
for (const test of expectedOutcome.keys()) check(seen.has(test), `missing test: ${test}`);

// Skip reasons, as the report reads them (src/renderer/skip.ts).
const skipKinds = new Set();
for (const test of report.tests.filter((item) => item.outcome === 'skipped')) {
  const skips = [...(test.attempts.at(-1)?.annotations ?? []), ...test.annotations].filter((a) => a.type === 'skip' || a.type === 'fixme');
  if (skips.length === 0) skipKinds.add('not run');
  for (const skip of skips) if (skip.description?.trim()) skipKinds.add(`${skip.type} with a reason`);
}
for (const kind of ['skip with a reason', 'fixme with a reason', 'not run']) check(skipKinds.has(kind), `no skipped test of kind "${kind}"`);

// Error groups and categories.
const groups = new Map();
const categories = new Set();
for (const test of report.tests) {
  for (const attempt of test.attempts.filter(isFailing)) {
    for (const error of attempt.errors) {
      if (!groups.has(error.signature)) groups.set(error.signature, new Set());
      groups.get(error.signature).add([test.file, ...test.suitePath, test.title].join('\0'));
      if (error.category) categories.add(error.category);
    }
  }
}
check([...groups.values()].some((tests) => tests.size >= 3), 'no error group shared by 3 tests or more');
for (const category of CATEGORIES) check(categories.has(category), `no error in category "${category}"`);

// Dimensions, steps, attachments.
const dimensionNames = report.dimensions.map((dimension) => dimension.name);
for (const dimension of DIMENSIONS) check(dimensionNames.includes(dimension), `no dimension "${dimension}"`);
const attempts = report.tests.flatMap((test) => test.attempts);
const hasNestedStep = (steps) => steps.some((step) => (step.category === 'test.step' && step.steps.some((child) => child.category === 'test.step')) || hasNestedStep(step.steps));
check(attempts.some((attempt) => hasNestedStep(attempt.steps)), 'no nested test.step');
const attachments = attempts.flatMap((attempt) => attempt.attachments);
check(attachments.some((attachment) => attachment.comparison?.role === 'diff'), 'no screenshot comparison');
check(attachments.some((attachment) => attachment.kind === 'video' && attachment.path), 'no video');
check(attachments.some((attachment) => attachment.kind === 'trace' && attachment.path), 'no trace');
for (const attachment of attachments) check(attachment.path === null || existsSync(join(reportDir, attachment.path)), `missing attachment file: ${attachment.path}`);

// Size of the Pages site.
const folderSize = (dir) =>
  readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => {
    const path = join(dir, entry.name);
    return sum + (entry.isDirectory() ? folderSize(path) : statSync(path).size);
  }, 0);
const bytes = folderSize(reportDir);
check(bytes <= MAX_BYTES, `report folder is ${(bytes / 1024 / 1024).toFixed(1)} MB, ceiling ${MAX_BYTES / 1024 / 1024} MB`);

// The rendered report: it loads, and shows exactly one common failure point.
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(pathToFileURL(indexFile).href);
  // The Overview's widgets render after the shell; Run details is the last one.
  await page.locator('#w-run-details').waitFor();
  const points = await page.locator('.widget-failure-points .point-fn').allTextContents();
  check(points.length === 1 && points[0] === FAILURE_POINT, `common failure points: [${points.join(', ')}], expected [${FAILURE_POINT}]`);
  for (const message of pageErrors) problems.push(`error in the rendered report: ${message}`);
} finally {
  await browser.close();
}

if (problems.length > 0) {
  console.error(`\nrun-demo: unexpected outcome (see demo/README.md):\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}

console.log(`\nrun-demo: the demo suite failed as intended. ${report.tests.length} tests, report ${(bytes / 1024 / 1024).toFixed(1)} MB.`);

// A report built here holds this machine's paths in its stack traces: fine to
// look at, not to publish. The live demo is built in CI only.
if (!process.env.CI) {
  const home = homedir();
  if ([reportFile, indexFile].some((file) => readFileSync(file, 'utf8').includes(home))) {
    console.warn(`run-demo: this report contains your home directory (${home}) in stack traces. Do not publish it or take README screenshots from it.`);
  }
}

console.log(`Open ${pathToFileURL(indexFile).href}`);
if (process.argv.includes('--open')) {
  const [command, ...args] =
    process.platform === 'darwin' ? ['open'] : process.platform === 'win32' ? ['cmd', '/c', 'start', '""'] : ['xdg-open'];
  spawn(command, [...args, indexFile], { detached: true, stdio: 'ignore' }).unref();
}
