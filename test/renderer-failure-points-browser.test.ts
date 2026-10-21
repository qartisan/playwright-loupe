import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RENDERER_SETTINGS, injectData, injectSettings } from '../src/core/inject.js';
import { TEXT_CONTRAST } from '../src/shared/color.js';
import { cascadeReport } from './helpers/cascade.js';
import { textContrasts } from './helpers/contrast.js';
import { ROOT, assertBuilt } from './helpers/fixtures.js';

/**
 * Common failure points in the built renderer opened from file://, on the
 * synthetic cascade sample (test/helpers/cascade.ts): the Overview card, its
 * links, the Failure point facet, keyboard use, narrow screens and contrast
 * in both themes.
 */

const RENDERER = path.join(ROOT, 'dist/renderer/index.html');
const SIGN_IN = 'fixtures/session.fixtures.ts#signIn';

describe('common failure points in a browser (file://)', { timeout: 60_000 }, () => {
  let browser: Browser;
  let workDir: string;
  let url: string;

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

  const fragment = (page: Page): string => `#${page.url().split('#')[1] ?? ''}`;

  beforeAll(async () => {
    assertBuilt();
    workDir = mkdtempSync(path.join(tmpdir(), 'loupe-points-'));
    const file = path.join(workDir, 'cascade.html');
    writeFileSync(file, injectSettings(injectData(readFileSync(RENDERER, 'utf8'), cascadeReport()), DEFAULT_RENDERER_SETTINGS));
    url = pathToFileURL(file).href;
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it('shows the card after the run errors and before the error categories, one row per point', async () => {
    const { page, errors } = await open('#/');
    const card = page.getByRole('region', { name: 'Common failure points' });
    await card.waitFor();
    const headings = await page.locator('.view-overview .widget > h2').allTextContents();
    expect(headings.indexOf('Common failure points')).toBe(headings.indexOf('Error categories') - 1);
    expect(await card.locator('.widget-note').textContent()).toMatch(/^Functions from your code that appear in the stack of several failures/);
    const rows = card.locator('.point-row');
    expect(await rows.count()).toBe(3);
    const first = rows.first();
    expect(await first.locator('.point-fn').textContent()).toBe('signIn');
    expect(await first.locator('.point-where').textContent()).toBe('fixtures/session.fixtures.ts · lines 41, 58');
    expect(await first.locator('.point-via').textContent()).toBe('via AccountService.loginWith');
    expect(await first.locator('.point-counts .group-count').textContent()).toBe('10 tests · 8 files · 3 error groups');
    expect(await first.locator('.group-split').textContent()).toBe('8 failed2 flaky');
    expect(await first.locator('.category-badge').allTextContents()).toEqual(['Timeout', 'Uncategorized']);
    // No flaky test: no split. A point outside the root dir keeps its `../` path.
    expect(await rows.nth(1).locator('.group-split').count()).toBe(0);
    expect(await rows.nth(2).locator('.point-where code').textContent()).toBe('../packages/api-client/src/client.ts');
    // A lead, never presented as a diagnosis: the wording ruled out for this card (CLAUDE.md, brief 10).
    expect(await page.locator('body').textContent()).not.toMatch(new RegExp(['root', 'cause'].join(' '), 'i'));
    expect(errors).toEqual([]);
    await page.context().close();
  });

  it('links a point to its tests, in the Tests view and the sidebar, with the keyboard', async () => {
    const { page, errors } = await open('#/');
    const link = page.locator('.point-row').first();
    expect(await link.getAttribute('href')).toBe(`#/tests?point=${encodeURIComponent(SIGN_IN)}`);
    await link.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { level: 1, name: 'Tests' }).waitFor();
    expect(fragment(page)).toBe(`#/tests?point=${encodeURIComponent(SIGN_IN)}`);
    // 10 tests, two of them in both projects.
    expect(await page.locator('.tests-table tbody tr').count()).toBe(12);
    await expect.poll(() => page.locator('.tree-test').count()).toBe(12);
    expect(await page.locator('.chip').allTextContents()).toEqual(['Failure point: signIn (fixtures/session.fixtures.ts)']);
    // Back returns to the Overview: the link pushed a history entry.
    await page.goBack();
    await page.getByRole('region', { name: 'Common failure points' }).waitFor();
    expect(errors).toEqual([]);
    await page.context().close();
  });

  it('offers the points as a facet after the error category, and its URL works in another tab', async () => {
    const { page, errors } = await open('#/tests');
    await page.locator('.tests-table').waitFor();
    expect(await page.locator('.facet-button > span:first-child').allTextContents()).toEqual(['Status', 'Error category', 'Failure point', 'Project']);
    await page.locator('.facet[data-facet="point"] summary').click();
    const group = page.getByRole('group', { name: 'Failure point' });
    expect(await group.locator('.facet-option code').allTextContents()).toEqual(['signIn', 'readerFactory', 'ApiClient.send']);
    expect(await group.locator('.facet-count').allTextContents()).toEqual(['12 tests', '6 tests', '5 tests']);
    await group.getByRole('checkbox', { name: /readerFactory/ }).check();
    await page.keyboard.press('Escape');
    expect(await page.locator('.tests-table tbody tr').count()).toBe(6);
    const copied = page.url();
    expect(fragment(page)).toBe(`#/tests?point=${encodeURIComponent('fixtures/data.fixtures.ts#readerFactory')}`);
    // Pasted into another tab, over file://: same filter, same rows.
    const other = await page.context().newPage();
    await other.goto(copied);
    await other.locator('.tests-table').waitFor();
    expect(await other.locator('.tests-table tbody tr').count()).toBe(6);
    expect(await other.locator('.tree-test').count()).toBe(6);
    // An unknown point is dropped and the URL normalized.
    await other.goto(`${url}#/tests?point=${encodeURIComponent('lib/gone.ts#nothing')}&status=failed`);
    await other.locator('.tests-table').waitFor();
    expect(fragment(other)).toBe('#/tests?status=failed');
    expect(errors).toEqual([]);
    await page.context().close();
  });

  it('has no horizontal page scroll at 320px', async () => {
    const { page, errors } = await open('#/', { width: 320 });
    await page.getByRole('region', { name: 'Common failure points' }).waitFor();
    expect(await page.evaluate<boolean>('document.documentElement.scrollWidth <= document.documentElement.clientWidth')).toBe(true);
    const card = await page.locator('.widget-failure-points').boundingBox();
    expect((card?.x ?? 0) + (card?.width ?? 0)).toBeLessThanOrEqual(320);
    expect(errors).toEqual([]);
    await page.context().close();
  });

  it.each(['light', 'dark'] as const)(`keeps every text of the card and the facet at ${TEXT_CONTRAST}:1, %s theme`, async (colorScheme) => {
    const { page, errors } = await open('#/', { colorScheme });
    const card = page.locator('.widget-failure-points');
    await card.waitFor();
    expect((await textContrasts(card)).filter(({ ratio }) => ratio < TEXT_CONTRAST)).toEqual([]);
    await page.goto(`${url}#/tests`);
    await page.locator('.facet[data-facet="point"] summary').click();
    expect((await textContrasts(page.locator('.facet[data-facet="point"]'))).filter(({ ratio }) => ratio < TEXT_CONTRAST)).toEqual([]);
    expect(errors).toEqual([]);
    await page.context().close();
  });
});
