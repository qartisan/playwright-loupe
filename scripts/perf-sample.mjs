// Writes 5,000-test reports for performance measurements of the renderer, and
// optionally times the Tests view on them.
//
//   npm run perf:sample                                   # write the reports
//   npm run perf:sample -- --measure                      # and time them with dist/renderer
//   npm run perf:sample -- --measure --renderer old.html  # time another renderer build
//
// Three datasets, all the renderer dev sample (src/renderer/dev/sample.json)
// replicated to 5,000 tests with unique ids and titles, as in the cap test:
// - `sample`: the sample's own tags and dimensions (1 to 3 chips per row);
// - `heavy`: six more tags and two `area` values per test (7 to 8 chips per row);
// - `cascade`: the sample's tests spread over 50 spec files, every failing
//   error with a realistic stack: 4 to 8 frames through invented helpers
//   (named, `Object.` and `async` frames), some inside the testDir and some
//   outside it (`../fixtures/…`), relative to it as the core writes them, so
//   the common failure points have real work to do.
// Each is written to loupe-perf/<dataset>/ (report.json and index.html).
//
// --measure opens each report from file:// in Chromium, RUNS times, and prints
// the median of: opening the Overview until its last widget is rendered;
// opening the Tests view until its 500th row is rendered; checking the Passed
// status filter; sorting by Duration; and a search (`q=order`, set through the
// URL to skip the input debounce). Each timing ends after the next frame
// (requestAnimationFrame, then a task), so it covers rendering and layout.
// Expects a built reporter (`npm run perf:sample` builds first).

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { DEFAULT_RENDERER_SETTINGS, injectData, injectSettings } from '../dist/core/inject.js';

const COUNT = 5000;
const RUNS = 7;
const HEAVY_TAGS = ['@smoke', '@regression', '@slow', '@checkout', '@nightly', '@area:cart'];

const { values: options } = parseArgs({
  options: { measure: { type: 'boolean', default: false }, renderer: { type: 'string' } },
});
const root = fileURLToPath(new URL('../', import.meta.url));
const output = `${root}loupe-perf/`;
const renderer = readFileSync(options.renderer ?? `${root}dist/renderer/index.html`, 'utf8');
const sample = JSON.parse(readFileSync(`${root}src/renderer/dev/sample.json`, 'utf8'));

/** Invented helpers, innermost first within each chain: [frame function, path relative to the testDir]. */
const CASCADE_HELPERS = [
  ['ApiClient.request', '../lib/api-client.ts'],
  ['async ApiClient.send', '../lib/api-client.ts'],
  ['SessionService.login', '../services/session.service.ts'],
  ['async signIn', '../fixtures/session.fixtures.ts'],
  ['Object.customerFactory', '../fixtures/data.fixtures.ts'],
  ['Object.orderFactory', '../fixtures/data.fixtures.ts'],
  ['CartPage.addItem', 'support/pages/cart.page.ts'],
  ['async CartPage.open', 'support/pages/cart.page.ts'],
  ['CheckoutPage.pay', 'support/pages/checkout.page.ts'],
  ['SearchPage.search', 'support/pages/search.page.ts'],
  ['waitForIdle', 'support/wait.ts'],
  ['async retry', 'support/retry.ts'],
  ['expectToast', 'support/assertions.ts'],
  ['Object.seedCatalog', '../fixtures/catalog.fixtures.ts'],
  ['InventoryService.reserve', '../services/inventory.service.ts'],
];
const CASCADE_FILES = 50;

/** A stack for a failing error: 4 to 8 helper frames picked from the test index, then the test file. */
function cascadeStack(message, file, index) {
  const depth = 4 + (index % 5);
  const start = (index * 7) % CASCADE_HELPERS.length;
  const frames = Array.from({ length: depth }, (_, step) => {
    const [fn, relative] = CASCADE_HELPERS[(start + step * 3) % CASCADE_HELPERS.length];
    return `    at ${fn} (${relative}:${10 + ((index + step) % 40)}:${3 + step})`;
  });
  return [message, ...frames, `    at ${file}:${12 + (index % 30)}:5`].join('\n');
}

function dataset(kind) {
  const tests = Array.from({ length: COUNT }, (_, index) => {
    const test = sample.tests[index % sample.tests.length];
    const extra = kind === 'heavy' ? { tags: [...new Set([...test.tags, ...HEAVY_TAGS])], dimensions: { ...test.dimensions, area: ['cart', 'checkout'] } } : {};
    const copy = { ...test, ...extra, id: index.toString(16).padStart(16, '0'), title: `${test.title} #${index}` };
    if (kind !== 'cascade') return copy;
    const file = `area-${String(index % 10).padStart(2, '0')}/feature-${Math.floor(index / 10) % (CASCADE_FILES / 10)}.spec.ts`;
    const attempts = test.attempts.map((attempt) => ({
      ...attempt,
      errors: attempt.errors.map((error) => ({ ...error, stack: cascadeStack(error.message, file, index) })),
    }));
    return { ...copy, file, attempts };
  });
  return { ...sample, tests };
}

rmSync(output, { recursive: true, force: true });
const urls = {};
for (const name of ['sample', 'heavy', 'cascade']) {
  const folder = `${output}${name}/`;
  mkdirSync(folder, { recursive: true });
  const data = dataset(name);
  writeFileSync(`${folder}report.json`, JSON.stringify(data));
  writeFileSync(`${folder}index.html`, injectSettings(injectData(renderer, data), DEFAULT_RENDERER_SETTINGS));
  urls[name] = pathToFileURL(`${folder}index.html`).href;
  console.log(`wrote loupe-perf/${name}/ (${COUNT} tests)`);
}

if (options.measure) {
  const SETTLE = 'new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))';
  /** Runs `action` in the page and returns the time until the next frame has been rendered. */
  const timed = (locator, action) =>
    locator.evaluate(
      async (element, [action, settle]) => {
        const start = performance.now();
        if (action === 'click') element.click();
        else location.hash = action;
        await eval(settle);
        return performance.now() - start;
      },
      [action, SETTLE],
    );
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

  const browser = await chromium.launch();
  for (const [name, url] of Object.entries(urls)) {
    const results = { overview: [], open: [], filter: [], sort: [], search: [] };
    for (let run = 0; run < RUNS; run += 1) {
      const overview = await browser.newPage({ viewport: { width: 1300, height: 900 } });
      const opened = Date.now();
      await overview.goto(`${url}#/`);
      await overview.locator('.run-details').waitFor();
      await overview.evaluate(SETTLE);
      results.overview.push(Date.now() - opened);
      await overview.close();
      const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
      const start = Date.now();
      await page.goto(`${url}#/tests`);
      await page.locator('.tests-table tbody tr').nth(499).waitFor();
      await page.evaluate(SETTLE);
      results.open.push(Date.now() - start);
      await page.locator('.facet[data-facet="status"] summary').click();
      results.filter.push(await timed(page.getByRole('checkbox', { name: /^Passed/ }), 'click'));
      await page.keyboard.press('Escape');
      results.sort.push(await timed(page.getByRole('button', { name: 'Duration' }), 'click'));
      results.search.push(await timed(page.locator('body'), '#/tests?q=order'));
      await page.close();
    }
    const line = Object.entries(results).map(([key, values]) => `${key} ${median(values).toFixed(0)} ms`);
    console.log(`${name}: ${line.join(', ')} (median of ${RUNS})`);
  }
  await browser.close();
}
