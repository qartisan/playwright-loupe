import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RENDERER_SETTINGS, injectData, injectSettings } from '../src/core/inject.js';
import { NOT_RUN_EXPLANATION } from '../src/renderer/skip.js';
import type { LoupeReport, TestCase } from '../src/schema/v1.js';
import { TEXT_CONTRAST } from '../src/shared/color.js';
import { textContrasts } from './helpers/contrast.js';
import { ROOT, assertBuilt } from './helpers/fixtures.js';

/**
 * Why a test was skipped, in the built renderer opened from file://, on the
 * dev sample (the fixture suite: skips with and without a reason, fixme, and
 * a test not run after a failure in its serial group): Suite health, the
 * Tests view, the test detail header and the search, in both themes and down
 * to 320px.
 */

const RENDERER = path.join(ROOT, 'dist/renderer/index.html');
const SAMPLE = path.join(ROOT, 'src/renderer/dev/sample.json');
const NOT_RUN = `Not run. ${NOT_RUN_EXPLANATION}`;
const LONG_REASON = `Waits for the payment provider sandbox, ${'which is only available on the nightly environment '.repeat(4)}(end)`;

/** Expected label per skipped test title, from fixtures/tests/outcomes.spec.ts. */
const EXPECTED: Record<string, string> = {
  'is skipped (intentional)': 'Skipped (no reason given)',
  'is marked fixme (intentional)': 'Fixme (no reason given)',
  'skips at runtime with a reason on one project': 'Skipped: Runs on chromium-a only',
  'is marked fixme at runtime with a reason': 'Fixme: Export button not implemented yet',
  'is skipped by its describe with a reason': 'Skipped: Not supported on Chromium',
  'is not run after a failure in its serial group': NOT_RUN,
};

describe('skip reasons in a browser (file://)', { timeout: 60_000 }, () => {
  let browser: Browser;
  let workDir: string;
  let url: string;
  let longUrl: string;
  let report: LoupeReport;

  async function open(target: string, options: { colorScheme?: 'light' | 'dark'; width?: number } = {}): Promise<{ page: Page; errors: string[] }> {
    const context = await browser.newContext({ colorScheme: options.colorScheme ?? 'light', viewport: { width: options.width ?? 1300, height: 900 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(target);
    await page.locator('.header').waitFor();
    return { page, errors };
  }

  const skippedTests = (): TestCase[] => report.tests.filter((test) => test.outcome === 'skipped');
  const noHorizontalScroll = (page: Page): Promise<boolean> =>
    page.evaluate<boolean>('document.documentElement.scrollWidth <= document.documentElement.clientWidth');

  function write(name: string, data: LoupeReport): string {
    const file = path.join(workDir, `${name}.html`);
    writeFileSync(file, injectSettings(injectData(readFileSync(RENDERER, 'utf8'), data), DEFAULT_RENDERER_SETTINGS));
    return pathToFileURL(file).href;
  }

  beforeAll(async () => {
    assertBuilt();
    workDir = mkdtempSync(path.join(tmpdir(), 'loupe-skip-'));
    report = JSON.parse(readFileSync(SAMPLE, 'utf8')) as LoupeReport;
    url = write('sample', report);
    // One skip reason far too long for a row: truncated in the Tests view, in full elsewhere.
    const long = { type: 'skip', description: LONG_REASON };
    const tests = report.tests.map((test) =>
      test.title === 'is skipped (intentional)' && test.project === 'chromium-a'
        ? { ...test, annotations: [long], attempts: test.attempts.map((attempt) => ({ ...attempt, annotations: [long] })) }
        : test,
    );
    longUrl = write('long', { ...report, tests });
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it('covers every kind of skip in the sample', () => {
    expect(new Set(skippedTests().map((test) => test.title))).toEqual(new Set(Object.keys(EXPECTED)));
  });

  it('shows the reason of every skipped test in Suite health, one row each, with the full text in the tooltip', async () => {
    const { page, errors } = await open(`${url}#/health`);
    const widget = page.locator('.widget-skipped');
    await widget.waitFor();
    const rows = widget.locator('li');
    expect(await rows.count()).toBe(skippedTests().length);
    for (const [index, test] of skippedTests().entries()) {
      const row = rows.nth(index);
      expect(await row.locator('.test-text > a').textContent()).toBe(test.title);
      const reason = row.locator('.skip-reason');
      // The text content is what assistive technologies read: the explanation of "Not run" included.
      expect(await reason.textContent()).toBe(EXPECTED[test.title]);
      expect(await reason.getAttribute('title')).toBe(EXPECTED[test.title]);
    }
    const notRun = rows.filter({ hasText: 'is not run after a failure' }).first().locator('.skip-reason');
    // On screen, "Not run" alone; the explanation is visually hidden.
    expect(await notRun.evaluate((element) => element.firstChild?.textContent)).toBe('Not run');
    expect(await notRun.locator('.visually-hidden').textContent()).toBe(`. ${NOT_RUN_EXPLANATION}`);
    expect(errors).toEqual([]);
    await page.context().close();
  });

  it('shows a muted line under the title in the Tests view, above the chips, and no category', async () => {
    const { page, errors } = await open(`${url}#/tests?status=skipped`);
    const rows = page.locator('.tests-table tbody tr');
    await expect.poll(() => rows.count()).toBe(skippedTests().length);
    for (let index = 0; index < skippedTests().length; index++) {
      const row = rows.nth(index);
      const title = (await row.locator('.cell-title > a').textContent()) ?? '';
      const expected = Object.entries(EXPECTED).find(([name]) => title.endsWith(name))?.[1];
      expect(await row.locator('.skip-line').textContent()).toBe(expected);
      expect(await row.locator('td').nth(5).textContent()).toBe('');
    }
    // Right under the title link (the sample has no repeat note), above the chips.
    const order = await page
      .locator('.tests-table .cell-title')
      .evaluateAll((cells) => cells.map((cell) => [...cell.children].map((child) => child.className.split(' ').at(-1))));
    for (const children of order) {
      expect(children.indexOf('skip-line')).toBe(1);
      if (children.includes('test-chips')) expect(children.indexOf('test-chips')).toBeGreaterThan(1);
    }
    // A passing test has no skip line.
    await page.goto(`${url}#/tests?status=passed`);
    await page.locator('.tests-table tbody tr').first().waitFor();
    expect(await page.locator('.tests-table .skip-line').count()).toBe(0);
    expect(errors).toEqual([]);
    await page.context().close();
  });

  it('truncates a long reason to one line in the Tests view, the full text in the tooltip and the accessible name', async () => {
    for (const width of [1300, 320]) {
      const { page, errors } = await open(`${longUrl}#/tests?status=skipped&project=chromium-a`, { width });
      const line = page.locator('.tests-table tbody tr').filter({ hasText: 'is skipped (intentional)' }).locator('.skip-line');
      await line.waitFor();
      expect(await line.textContent()).toBe(`Skipped: ${LONG_REASON}`);
      expect(await line.getAttribute('title')).toBe(`Skipped: ${LONG_REASON}`);
      const box = await line.evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth, height: element.getBoundingClientRect().height }));
      expect(box.scroll).toBeGreaterThan(box.client);
      expect(box.height).toBeLessThan(20);
      expect(await noHorizontalScroll(page)).toBe(true);
      expect(errors).toEqual([]);
      await page.context().close();
    }
  });

  it('shows the reason in full next to the outcome in the test detail header', async () => {
    const { page, errors } = await open(`${longUrl}#/tests?status=skipped&project=chromium-a`, { width: 320 });
    await page.locator('.tests-table tbody tr').filter({ hasText: 'is skipped (intentional)' }).locator('.cell-title > a').click();
    const summary = page.locator('.test-summary');
    await summary.waitFor();
    expect(await summary.locator('.detail-skip').textContent()).toBe(`Skipped: ${LONG_REASON}`);
    expect(await page.locator('.skip-explanation').count()).toBe(0);
    expect(await noHorizontalScroll(page)).toBe(true);

    await page.goto(`${url}#/tests?status=skipped&q=serial+group&project=chromium-b`);
    await page.locator('.tests-table tbody tr .cell-title > a').first().click();
    await page.locator('.test-summary .detail-skip').waitFor();
    expect(await page.locator('.test-summary .detail-skip').textContent()).toBe('Not run');
    expect(await page.locator('.test-header .skip-explanation').textContent()).toBe(NOT_RUN_EXPLANATION);
    expect(errors).toEqual([]);
    await page.context().close();
  });

  it('finds a test by a word of its skip reason', async () => {
    const { page, errors } = await open(`${url}#/tests?q=button+implemented`);
    const rows = page.locator('.tests-table tbody tr');
    await expect.poll(() => rows.count()).toBe(2);
    expect(new Set(await rows.locator('.cell-title > a').allTextContents())).toEqual(new Set(['skip reasons › is marked fixme at runtime with a reason']));
    // In the sidebar too.
    await expect.poll(() => page.locator('.tree-test').count()).toBe(2);
    expect(errors).toEqual([]);
    await page.context().close();
  });

  it.each(['light', 'dark'] as const)('keeps the skip reasons readable in the %s theme, with no horizontal scroll at 320px', async (colorScheme) => {
    for (const target of [`${url}#/health`, `${url}#/tests?status=skipped`]) {
      const { page, errors } = await open(target, { colorScheme, width: 320 });
      const reasons = page.locator('.skip-reason');
      await reasons.first().waitFor();
      for (const reason of await reasons.all()) {
        expect((await textContrasts(reason)).filter(({ ratio }) => ratio < TEXT_CONTRAST)).toEqual([]);
      }
      expect(await noHorizontalScroll(page)).toBe(true);
      expect(errors).toEqual([]);
      await page.context().close();
    }
    const { page } = await open(`${url}#/tests?status=skipped&q=serial+group`, { colorScheme, width: 320 });
    await page.locator('.tests-table tbody tr .cell-title > a').first().click();
    const header = page.locator('.test-header');
    await header.locator('.skip-explanation').waitFor();
    expect((await textContrasts(header)).filter(({ ratio }) => ratio < TEXT_CONTRAST)).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.context().close();
  });
});
