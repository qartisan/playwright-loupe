// Regenerates the README screenshots (docs/images/) from an existing demo
// report in demo-report/, in light and dark: five views, Chromium from
// @playwright/test, the report opened over file://.
//
// The report must be built in CI: a local one holds this machine's paths in
// its stack traces, and this script refuses it. Download the `demo-report`
// artifact of a green "Demo suite" job (ci.yml) into demo-report/, or the
// files of the live demo, then run `npm run demo:screenshots`.
//
// Usage: node scripts/demo-screenshots.mjs

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const reportDir = fileURLToPath(new URL('../demo-report/', import.meta.url));
const imagesDir = fileURLToPath(new URL('../docs/images/', import.meta.url));
const indexFile = join(reportDir, 'index.html');
const reportFile = join(reportDir, 'report.json');

const VIEWPORT = { width: 1280, height: 800 };
// Dates in English and in UTC, whoever runs the script.
const LOCALE = 'en-GB';
const TIMEZONE = 'UTC';
const THEMES = ['light', 'dark'];
/** The error group shown: the largest one of this category (the inventory failure shared by three tests). */
const GROUP_CATEGORY = 'Server error';

function fail(message) {
  console.error(`demo-screenshots: ${message}`);
  process.exit(1);
}

if (!existsSync(indexFile) || !existsSync(reportFile)) fail(`no demo report in ${reportDir}. Download the CI-built one first (see the top of this script).`);

const html = readFileSync(indexFile, 'utf8');
const json = readFileSync(reportFile, 'utf8');
const home = homedir();
if (html.includes(home) || json.includes(home)) {
  fail(`the report in ${reportDir} contains your home directory (${home}): it was built on this machine. README images come from a CI-built report only (see the top of this script).`);
}
const settings = JSON.parse(/<script id="loupe-settings" type="application\/json">(.*?)<\/script>/s.exec(html)?.[1] ?? '{}');
if (settings.theme !== 'system') fail(`the report's theme is "${settings.theme}", expected "system": both themes come from the browser's color scheme.`);

const report = JSON.parse(json);
/** The test detail shown: the screenshot comparison failure, for its comparison viewer. */
const visual = report.tests.find((test) => test.category === 'Visual regression');
if (!visual) fail('no test in category "Visual regression"');
const groups = new Map();
for (const test of report.tests) {
  for (const attempt of test.attempts) {
    for (const error of attempt.errors) {
      if (error.category !== GROUP_CATEGORY) continue;
      if (!groups.has(error.signature)) groups.set(error.signature, new Set());
      groups.get(error.signature).add(test.id);
    }
  }
}
const [signature] = [...groups].sort((a, b) => b[1].size - a[1].size)[0] ?? [];
if (!signature) fail(`no error group in category "${GROUP_CATEGORY}"`);

// Each view: its route, an element showing it is rendered, and what to do before the shot.
const VIEWS = [
  { name: 'overview', hash: '#/', ready: '.widget-failure-points .point-fn' },
  { name: 'errors', hash: `#/group/${signature}`, ready: 'main h1' },
  { name: 'health', hash: '#/health', ready: '.widget-dimension' },
  { name: 'tests', hash: '#/tests?status=failed,flaky', ready: 'main table tbody tr' },
  {
    name: 'test-detail',
    hash: `#/test/${visual.id}`,
    ready: '.comparison',
    // The attempt tabs are far above the comparison: the shot shows the attachments, side by side.
    prepare: async (page) => {
      await page.locator('.comparison').getByRole('button', { name: 'Side by side' }).click();
      await page.locator('section[aria-labelledby="detail-attachments"]').evaluate((section) => section.scrollIntoView({ block: 'start' }));
    },
  },
];

mkdirSync(imagesDir, { recursive: true });
const base = pathToFileURL(indexFile).href;
const browser = await chromium.launch();
const written = [];
try {
  for (const theme of THEMES) {
    // A fresh context per theme: no theme remembered in localStorage, the report follows colorScheme.
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      colorScheme: theme,
      reducedMotion: 'reduce',
      locale: LOCALE,
      timezoneId: TIMEZONE,
    });
    const pageErrors = [];
    for (const view of VIEWS) {
      // A page per view: a goto that only changes the hash would keep the previous view's state (sidebar expansion).
      const page = await context.newPage();
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await page.goto(`${base}${view.hash}`);
      await page.locator(view.ready).first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      await view.prepare?.(page);
      // Let the layout and any scroll settle.
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const file = join(imagesDir, `${view.name}-${theme}.png`);
      await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
      written.push(file);
      await page.close();
    }
    if (pageErrors.length > 0) fail(`errors in the report (${theme}):\n  - ${pageErrors.join('\n  - ')}`);
    await context.close();
  }
} finally {
  await browser.close();
}

// The README of published versions points at overview.png: keep it, as the light Overview.
const legacy = join(imagesDir, 'overview.png');
copyFileSync(join(imagesDir, 'overview-light.png'), legacy);
written.push(legacy);

let total = 0;
for (const file of written) {
  const { size } = statSync(file);
  total += size;
  console.log(`${file.slice(imagesDir.length).padEnd(24)} ${(size / 1024).toFixed(0).padStart(5)} KiB`);
}
console.log(`demo-screenshots: ${written.length} images, ${(total / 1024).toFixed(0)} KiB in docs/images/.`);
