import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RENDERER_SETTINGS, injectData, injectSettings } from '../src/core/inject.js';
import type { LoupeReport, TestCase } from '../src/schema/v1.js';
import { TEXT_CONTRAST } from '../src/shared/color.js';
import { CASCADE_ERRORS, cascadeReport } from './helpers/cascade.js';
import { textContrasts } from './helpers/contrast.js';
import { ROOT, assertBuilt } from './helpers/fixtures.js';

/**
 * Error groups only seen after a test timeout, in the built renderer opened
 * from file://, on the synthetic cascade sample (test/helpers/cascade.ts):
 * folded in the Errors view and its categories, counted apart, walked last
 * with n / p, and labelled in the test detail.
 */

const RENDERER = path.join(ROOT, 'dist/renderer/index.html');

describe('error groups only seen after a test timeout in a browser (file://)', { timeout: 60_000 }, () => {
  let browser: Browser;
  let workDir: string;
  let url: string;
  let report: LoupeReport;

  async function open(hash: string, options: { colorScheme?: 'light' | 'dark'; width?: number } = {}): Promise<{ page: Page; errors: string[] }> {
    const context = await browser.newContext({ colorScheme: options.colorScheme ?? 'light', viewport: { width: options.width ?? 1300, height: 900 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(`${url}${hash}`);
    await page.locator('.header').waitFor();
    return { page, errors };
  }

  const find = (title: string): TestCase => report.tests.find((test) => test.title === title) as TestCase;

  beforeAll(async () => {
    assertBuilt();
    workDir = mkdtempSync(path.join(tmpdir(), 'loupe-secondary-'));
    report = cascadeReport();
    const file = path.join(workDir, 'cascade.html');
    writeFileSync(file, injectSettings(injectData(readFileSync(RENDERER, 'utf8'), report), DEFAULT_RENDERER_SETTINGS));
    url = pathToFileURL(file).href;
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it('folds them in a collapsed disclosure at the end of the global list, operable with the keyboard', async () => {
    const { page, errors } = await open('#/errors');
    const widget = page.locator('.widget-groups');
    await widget.waitFor();
    expect(await widget.locator('h2').textContent()).toBe('7 error groups');
    expect(await widget.locator('.widget-note').first().textContent()).toContain('7 error groups · 3 more only seen after a test timeout.');
    expect(await widget.locator(':scope > .group-list > li').count()).toBe(7);
    const disclosure = widget.locator(':scope > .after-timeout');
    const summary = disclosure.locator('summary');
    expect(await summary.textContent()).toBe('3 groups only seen after a test timeout');
    expect(await disclosure.getAttribute('open')).toBeNull();
    expect(await disclosure.locator('.group-row').first().isVisible()).toBe(false);
    await summary.focus();
    await page.keyboard.press('Enter');
    expect(await disclosure.getAttribute('open')).toBe('');
    expect(await disclosure.locator('.group-row').count()).toBe(3);
    expect(await disclosure.locator('.group-row').first().isVisible()).toBe(true);
    await page.keyboard.press(' ');
    expect(await disclosure.getAttribute('open')).toBeNull();
    expect(errors).toEqual([]);
    await page.context().close();
  });

  it('counts groups per category without them, with the mention, and folds them in each category', async () => {
    const { page, errors } = await open(`#/errors/category/${encodeURIComponent('Uncategorized')}`);
    const category = (name: string) => page.locator(`.category-list > li[data-category="${name}"]`);
    await category('Uncategorized').waitFor();
    expect(await category('Uncategorized').locator('summary .muted').first().textContent()).toBe('1 error group · 2 more only seen after a test timeout');
    expect(await category('Uncategorized').locator('summary .group-count').first().textContent()).toBe('10 tests');
    // The category opened from its route: one visible group, two folded.
    expect(await category('Uncategorized').locator('details[open] > .group-list > li').count()).toBe(1);
    expect(await category('Uncategorized').locator('.after-timeout summary').textContent()).toBe('2 groups only seen after a test timeout');
    // A category whose groups are all folded stays listed, with its tests.
    expect(await category('Network').locator('summary .muted').first().textContent()).toBe('0 error groups · 1 more only seen after a test timeout');
    expect(await category('Network').locator('summary .group-count').first().textContent()).toBe('1 test');
    // The Overview link says so too.
    await page.goto(`${url}#/`);
    expect(await page.locator('.widget-categories .widget-note').textContent()).toBe('Failing tests per category. All 7 error groups · 3 more only seen after a test timeout');
    expect(errors).toEqual([]);
    await page.context().close();
  });

  it('keeps their pages reachable, walked after the visible groups with j / k', async () => {
    const { page, errors } = await open(`#/group/${CASCADE_ERRORS.contextDisposed.signature}`);
    await page.locator('.group-page').waitFor();
    expect(await page.locator('.group-note').textContent()).toMatch(/^Only seen after a test timeout/);
    // 7 visible groups, then the folded ones: this is the first of them.
    expect(await page.locator('.pager-position').textContent()).toBe('8 of 10');
    await page.locator('body').press('k');
    await expect.poll(() => page.url()).toMatch(/#\/group\/[0-9a-f]{12}/);
    expect(await page.locator('.group-note').count()).toBe(0);
    expect(errors).toEqual([]);
    await page.context().close();
  });

  it('labels a secondary error in the test detail, and only that one', async () => {
    const test = find('returns a book');
    const { page, errors } = await open(`#/test/${test.id}`);
    const cards = page.getByRole('tabpanel').locator('.error-card');
    await expect.poll(() => cards.count()).toBe(2);
    expect(await cards.nth(0).locator('.error-secondary').count()).toBe(0);
    expect(await cards.nth(1).locator('.error-secondary').textContent()).toBe('Raised after the test timeout');
    // Its group link still works.
    expect(await cards.nth(1).locator('.error-group-link').getAttribute('href')).toBe(`#/group/${CASCADE_ERRORS.contextDisposed.signature}`);
    // An error after another first error is not labelled.
    await page.goto(`${url}#/test/${find('sorts the results').id}`);
    await page.getByRole('tabpanel').locator('.error-card').first().waitFor();
    expect(await page.locator('.error-secondary').count()).toBe(0);
    expect(errors).toEqual([]);
    await page.context().close();
  });

  it('has no horizontal page scroll at 320px', async () => {
    const { page, errors } = await open('#/errors', { width: 320 });
    await page.locator('.widget-groups .after-timeout summary').click();
    expect(await page.evaluate<boolean>('document.documentElement.scrollWidth <= document.documentElement.clientWidth')).toBe(true);
    expect(errors).toEqual([]);
    await page.context().close();
  });

  it.each(['light', 'dark'] as const)(`keeps the disclosure and the label at ${TEXT_CONTRAST}:1, %s theme`, async (colorScheme) => {
    const { page, errors } = await open('#/errors', { colorScheme });
    const disclosure = page.locator('.widget-groups .after-timeout');
    await disclosure.locator('summary').click();
    expect((await textContrasts(disclosure)).filter(({ ratio }) => ratio < TEXT_CONTRAST)).toEqual([]);
    await page.goto(`${url}#/test/${find('returns a book').id}`);
    const label = page.locator('.error-secondary');
    await label.waitFor();
    expect((await textContrasts(label)).filter(({ ratio }) => ratio < TEXT_CONTRAST)).toEqual([]);
    expect(errors).toEqual([]);
    await page.context().close();
  });
});
