import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Locator, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RENDERER_SETTINGS, injectData, injectSettings } from '../src/core/inject.js';
import type { LoupeReport } from '../src/schema/v1.js';
import { cascadeReport } from './helpers/cascade.js';
import { ROOT, assertBuilt, isMissingAttachmentFile } from './helpers/fixtures.js';

/**
 * Focus and page title on view changes, scroll keys while nothing has
 * focus, and the focused sidebar row kept visible, in the built renderer opened from
 * file://. Another page (view, test, error group, category) moves focus to
 * its heading and sets the title; the first load, and any change inside a
 * page (filters, search, sort, "show more", attempts, steps, a dialog), never
 * move focus.
 */

const RENDERER = path.join(ROOT, 'dist/renderer/index.html');
const SAMPLE = path.join(ROOT, 'src/renderer/dev/sample.json');
const SUITE = 'Storefront';
const FLAKY = 'c2cd6f823ac2cec4';
const FAILING = 'e6c8105b02e8ef4c';

describe('focus and title on view changes (file://)', { timeout: 30_000 }, () => {
  let browser: Browser;
  let workDir: string;
  let sample: LoupeReport;
  const urls: Record<'sample' | 'cascade' | 'many', string> = { sample: '', cascade: '', many: '' };

  function writeReport(name: string, report: LoupeReport): string {
    const file = path.join(workDir, `${name}.html`);
    writeFileSync(file, injectSettings(injectData(readFileSync(RENDERER, 'utf8'), report), { ...DEFAULT_RENDERER_SETTINGS, title: SUITE }));
    return pathToFileURL(file).href;
  }

  async function open(url: string, width = 1300, options: { height?: number; reducedMotion?: 'reduce' | 'no-preference' } = {}): Promise<{ page: Page; errors: string[] }> {
    const page = await browser.newPage({ viewport: { width, height: options.height ?? 800 }, reducedMotion: options.reducedMotion ?? 'no-preference' });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && !isMissingAttachmentFile(message, page)) errors.push(message.text());
    });
    await page.goto(url);
    await page.locator('.main h1').first().waitFor();
    return { page, errors };
  }

  const heading = (page: Page): Locator => page.locator('.main h1');
  const hasFocus = (locator: Locator): Promise<boolean> => locator.first().evaluate((element) => element === element.ownerDocument.activeElement);
  const headingFocused = (page: Page): Promise<boolean> => hasFocus(heading(page));
  /** Waits two frames: past the effects of a render, where a wrong focus move would happen. */
  const settle = (page: Page): Promise<unknown> => page.evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const activeTag = (page: Page): Promise<string> => page.evaluate<string>('document.activeElement.tagName');
  const testTitle = (id: string): string => sample.tests.find((test) => test.id === id)!.title;

  beforeAll(async () => {
    assertBuilt();
    workDir = mkdtempSync(path.join(tmpdir(), 'loupe-focus-'));
    sample = JSON.parse(readFileSync(SAMPLE, 'utf8')) as LoupeReport;
    urls.sample = writeReport('sample', sample);
    urls.cascade = writeReport('cascade', cascadeReport());
    const tests = Array.from({ length: 600 }, (_, index) => {
      const test = sample.tests[index % sample.tests.length]!;
      return { ...test, id: index.toString(16).padStart(16, '0'), title: `${test.title} #${index}` };
    });
    urls.many = writeReport('many', { ...sample, tests });
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it.each([
    ['#/', 'Overview'],
    ['#/errors', 'Errors'],
    ['#/health', 'Suite health'],
    ['#/tests?status=failed', 'Tests'],
    [`#/test/${FAILING}`, 'fails first in a serial group (intentional)'],
    ['#/nope', 'Not found'],
  ])('titles %s on load, without moving focus', async (hash, page) => {
    const { page: tab, errors } = await open(`${urls.sample}${hash}`);
    expect(await tab.title()).toBe(`${page} · ${SUITE}`);
    expect(await activeTag(tab)).toBe('BODY');
    expect(errors).toEqual([]);
    await tab.close();
  });

  it('titles an error group and a category', async () => {
    const { page } = await open(`${urls.cascade}#/group/a1c0de000001`);
    expect(await page.title()).toBe(`Error group · ${SUITE}`);
    await page.goto(`${urls.cascade}#/errors/category/Timeout`);
    await expect.poll(() => page.title()).toBe(`Timeout · ${SUITE}`);
    await page.close();
  });

  it('focuses the test heading after opening a test from the Tests table, and Tab continues in the page', async () => {
    const { page, errors } = await open(`${urls.sample}#/tests`);
    const link = page.locator('.tests-table tbody a').first();
    const title = (await link.textContent())!.split(' › ').pop()!;
    await link.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => headingFocused(page)).toBe(true);
    expect(await page.title()).toBe(`${title} · ${SUITE}`);
    // The heading is not a control: no focus ring.
    expect(await page.evaluate<string>('getComputedStyle(document.activeElement).outlineStyle')).toBe('none');
    await page.keyboard.press('Tab');
    expect(await page.locator('.main').evaluate((main) => main.contains(main.ownerDocument.activeElement))).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  });

  it('focuses the heading of the next and previous test with j and k', async () => {
    const { page } = await open(`${urls.sample}#/test/${FAILING}`);
    const first = await heading(page).textContent();
    await page.keyboard.press('j');
    await expect.poll(() => page.title()).not.toBe(`${testTitle(FAILING)} · ${SUITE}`);
    expect(await heading(page).textContent()).not.toBe(first);
    expect(await headingFocused(page)).toBe(true);
    await page.keyboard.press('k');
    await expect.poll(() => page.title()).toBe(`${testTitle(FAILING)} · ${SUITE}`);
    expect(await heading(page).textContent()).toBe(first);
    expect(await headingFocused(page)).toBe(true);
    await page.close();
  });

  it('focuses the heading of the next and previous error group with n and p', async () => {
    const { page } = await open(`${urls.cascade}#/group/a1c0de000001`);
    await page.keyboard.press('n');
    await expect.poll(() => page.url()).not.toContain('a1c0de000001');
    await expect.poll(() => headingFocused(page)).toBe(true);
    await page.keyboard.press('p');
    await expect.poll(() => page.url()).toContain('a1c0de000001');
    await expect.poll(() => headingFocused(page)).toBe(true);
    await page.close();
  });

  it('focuses the heading on Back and Forward', async () => {
    const { page } = await open(`${urls.sample}#/tests`);
    await page.locator('.tests-table tbody a').first().click();
    await expect.poll(() => headingFocused(page)).toBe(true);
    await page.goBack();
    await expect.poll(() => page.title()).toBe(`Tests · ${SUITE}`);
    expect(await heading(page).textContent()).toBe('Tests');
    expect(await headingFocused(page)).toBe(true);
    await page.goForward();
    await expect.poll(() => page.title()).not.toBe(`Tests · ${SUITE}`);
    expect(await headingFocused(page)).toBe(true);
    await page.close();
  });

  it.each([1300, 360])('focuses the heading after a sidebar link, at %ipx', async (width) => {
    const { page } = await open(`${urls.sample}#/`, width);
    if (width === 360) await page.getByRole('button', { name: 'Show sidebar' }).click();
    await page.locator('.nav-link', { hasText: 'Suite health' }).focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => headingFocused(page)).toBe(true);
    expect(await heading(page).textContent()).toBe('Suite health');
    // On narrow screens the sidebar overlay closes: focus is not left in it.
    if (width === 360) expect(await page.locator('#sidebar').isHidden()).toBe(true);
    await page.close();
  });

  it('keeps focus on the tree row after opening a test from the sidebar tree, and the title follows', async () => {
    const { page } = await open(`${urls.sample}#/`);
    const tree = page.locator('#sidebar [role="tree"]');
    await page.getByRole('treeitem', { level: 1 }).first().focus();
    // Down to the first test row: groups expand with ArrowRight.
    while ((await page.locator('[role="treeitem"]:focus').getAttribute('aria-expanded')) !== null) {
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
    }
    const title = (await page.locator('[role="treeitem"]:focus .row-label').textContent())!;
    await page.keyboard.press('Enter');
    await expect.poll(() => page.title()).toBe(`${title} · ${SUITE}`);
    await settle(page);
    expect(await tree.evaluate((element) => element.contains(element.ownerDocument.activeElement))).toBe(true);
    expect(await headingFocused(page)).toBe(false);
    await page.close();
  });

  it('moves focus to the heading after opening a test from the tree at 360px, where the sidebar closes', async () => {
    const { page } = await open(`${urls.sample}#/`, 360);
    await page.getByRole('button', { name: 'Show sidebar' }).click();
    await page.getByRole('treeitem', { level: 1 }).first().focus();
    while ((await page.locator('[role="treeitem"]:focus').getAttribute('aria-expanded')) !== null) {
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
    }
    await page.keyboard.press('Enter');
    await expect.poll(() => headingFocused(page)).toBe(true);
    expect(await page.locator('#sidebar').isHidden()).toBe(true);
    await page.close();
  });

  it('focuses the category, not the heading, when the errors view opens on a category', async () => {
    const { page } = await open(`${urls.sample}#/`);
    await page.evaluate("location.hash = '#/errors/category/Timeout'");
    await expect.poll(() => page.evaluate<string>('document.activeElement.closest("[data-category]")?.dataset.category ?? ""')).toBe('Timeout');
    await page.close();
  });

  describe('never moves focus inside a page', () => {
    it('on a filter, a sort and a search in the Tests view', async () => {
      const { page } = await open(`${urls.sample}#/tests`);
      await page.locator('.facets details > summary').first().click();
      const checkbox = page.locator('.facet-menu input[type="checkbox"]').first();
      await checkbox.focus();
      await page.keyboard.press('Space');
      await expect.poll(() => page.url()).toContain('status=');
      await settle(page);
      expect(await hasFocus(page.locator('.facet-menu input[type="checkbox"]').first())).toBe(true);

      const sort = page.locator('.sort-button', { hasText: 'Duration' });
      await sort.focus();
      await page.keyboard.press('Enter');
      await expect.poll(() => page.url()).toContain('sort=duration');
      await settle(page);
      expect(await hasFocus(sort)).toBe(true);

      const search = page.locator('#sidebar-search');
      await search.focus();
      await page.keyboard.type('fails');
      await expect.poll(() => page.url()).toContain('q=fails');
      await settle(page);
      expect(await hasFocus(search)).toBe(true);
      await page.close();
    });

    it('on a search from a test detail', async () => {
      const { page } = await open(`${urls.sample}#/test/${FAILING}`);
      const search = page.locator('#sidebar-search');
      await search.focus();
      await page.keyboard.type('fails');
      await expect.poll(() => page.url()).toContain('q=fails');
      await settle(page);
      expect(await hasFocus(search)).toBe(true);
      await page.close();
    });

    it('on "show more", which focuses the first added row', async () => {
      const { page } = await open(`${urls.many}#/tests`);
      const more = page.getByRole('button', { name: 'Show 100 more' });
      await more.focus();
      await page.keyboard.press('Enter');
      await expect.poll(() => page.locator('.tests-table tbody tr').count()).toBe(600);
      await settle(page);
      expect(await hasFocus(page.locator('.tests-table tbody tr').nth(500).locator('a').first())).toBe(true);
      await page.close();
    });

    it('on an attempt change, with the tabs or [ and ]', async () => {
      const { page } = await open(`${urls.sample}#/test/${FLAKY}`);
      const selected = page.locator('[role="tab"][aria-selected="true"]');
      await selected.focus();
      // The flaky test opens on its failing attempt, the first.
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => page.url()).toContain('attempt=1');
      await settle(page);
      expect(await hasFocus(page.locator('[role="tab"][aria-selected="true"]'))).toBe(true);

      const copy = page.locator('.copy-button').first();
      await copy.focus();
      await page.keyboard.press('[');
      await expect.poll(() => page.url()).toContain('attempt=0');
      await settle(page);
      expect(await hasFocus(copy)).toBe(true);
      await page.close();
    });

    it('on the steps toggle', async () => {
      const { page } = await open(`${urls.sample}#/test/${FAILING}`);
      const toggle = page.getByRole('button', { name: 'Show all steps' });
      await toggle.focus();
      await page.keyboard.press('Enter');
      await expect.poll(() => page.url()).toContain('steps=all');
      await settle(page);
      expect(await hasFocus(toggle)).toBe(true);
      await page.close();
    });

    it('when a dialog closes: focus returns to its opener', async () => {
      const { page } = await open(`${urls.sample}#/tests`);
      const opener = page.locator('[aria-keyshortcuts="?"]');
      await opener.focus();
      await page.keyboard.press('Enter');
      await page.locator('dialog.shortcuts-dialog[open]').waitFor();
      await page.keyboard.press('Escape');
      await expect.poll(() => hasFocus(opener)).toBe(true);
      await settle(page);
      expect(await hasFocus(opener)).toBe(true);
      await page.close();
    });
  });

  describe('scroll keys while nothing has focus', () => {
    const scrollTop = (page: Page): Promise<number> => page.locator('.main').evaluate((main) => main.scrollTop);

    it('scrolls the content with Page Down, End and Home right after load, without moving focus', async () => {
      const { page, errors } = await open(`${urls.sample}#/health`, 1300, { height: 600 });
      expect(await activeTag(page)).toBe('BODY');
      await page.keyboard.press('PageDown');
      await expect.poll(() => scrollTop(page)).toBeGreaterThan(400);
      await page.keyboard.press('End');
      await expect.poll(() => page.locator('.main').evaluate((main) => main.scrollTop + main.clientHeight >= main.scrollHeight - 1)).toBe(true);
      await page.keyboard.press('Home');
      await expect.poll(() => scrollTop(page)).toBe(0);
      await page.keyboard.press('Space');
      await expect.poll(() => scrollTop(page)).toBeGreaterThan(400);
      await page.keyboard.press('Shift+Space');
      await expect.poll(() => scrollTop(page)).toBe(0);
      await page.keyboard.press('ArrowDown');
      await expect.poll(() => scrollTop(page)).toBeGreaterThan(0);
      expect(await activeTag(page)).toBe('BODY');
      expect(errors).toEqual([]);
      await page.close();
    });

    it('scrolls at once under prefers-reduced-motion', async () => {
      const { page } = await open(`${urls.sample}#/health`, 1300, { height: 600, reducedMotion: 'reduce' });
      await page.keyboard.press('PageDown');
      expect(await scrollTop(page)).toBe(Math.round(await page.locator('.main').evaluate((main) => main.clientHeight * 0.875)));
      await page.close();
    });

    it('scrolls with Page Down after a click on text in the content', async () => {
      const { page } = await open(`${urls.sample}#/health`, 1300, { height: 600 });
      // A click on text focuses <main> (tabindex="-1") or leaves focus on <body>: either way, Page Down scrolls.
      await page.locator('.main .widget-note').first().click();
      expect(['BODY', 'MAIN']).toContain(await activeTag(page));
      await page.keyboard.press('PageDown');
      await expect.poll(() => scrollTop(page)).toBeGreaterThan(400);
      await page.close();
    });

    it('leaves the keys to a focused field, the tree, an open dialog and the shortcuts', async () => {
      const { page } = await open(`${urls.sample}#/health`, 1300, { height: 600 });
      await page.locator('#sidebar-search').focus();
      await page.keyboard.press('End');
      await page.keyboard.press('PageDown');
      await settle(page);
      expect(await scrollTop(page)).toBe(0);

      await page.getByRole('treeitem', { level: 1 }).first().focus();
      await page.keyboard.press('ArrowDown');
      await settle(page);
      expect(await scrollTop(page)).toBe(0);
      expect(await page.locator('[role="treeitem"]:focus').getAttribute('aria-level')).toBe('2');

      await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
      await page.locator('dialog.shortcuts-dialog[open]').waitFor();
      await page.keyboard.press('PageDown');
      await settle(page);
      expect(await scrollTop(page)).toBe(0);
      await page.close();

      // j still opens the next test with nothing focused.
      const { page: detail } = await open(`${urls.sample}#/test/${FAILING}`);
      await detail.keyboard.press('j');
      await expect.poll(() => detail.url()).not.toContain(FAILING);
      await detail.close();
    });
  });

  describe('sidebar tree', () => {
    /** Expands the tree from its first row and walks down `steps` rows. */
    async function walkDown(page: Page, steps: number): Promise<void> {
      await page.getByRole('treeitem', { level: 1 }).first().focus();
      for (let index = 0; index < steps; index++) {
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowDown');
      }
    }

    /** Whether the focused row is fully inside the scrolling area, below the search. */
    const rowVisible = (page: Page): Promise<boolean> =>
      page.evaluate(`(() => {
        const row = document.activeElement.querySelector(':scope > .row-content, :scope > *').getBoundingClientRect();
        const area = document.querySelector('.sidebar-scroll').getBoundingClientRect();
        const search = document.querySelector('.sidebar-search').getBoundingClientRect();
        return row.top >= Math.max(area.top, search.bottom) - 0.5 && row.bottom <= area.bottom + 0.5;
      })()`);

    it.each([
      [1300, 500],
      [360, 640],
    ])('keeps the focused row visible below the search, walking down and up with the arrow keys, at %ix%i', async (width, height) => {
      const { page } = await open(`${urls.sample}#/`, width, { height });
      if (width === 360) await page.getByRole('button', { name: 'Show sidebar' }).click();
      await walkDown(page, 40);
      const hidden: number[] = [];
      for (let step = 0; step < 60; step++) {
        await page.keyboard.press('ArrowUp');
        if (!(await rowVisible(page))) hidden.push(step);
      }
      expect(hidden).toEqual([]);
      await page.close();
    });

    it('marks the row of the current test with aria-current="page", and only that row', async () => {
      const { page } = await open(`${urls.sample}#/test/${FAILING}`);
      const current = page.locator('[role="treeitem"][aria-current="page"]');
      await expect.poll(() => current.count()).toBe(1);
      expect(await current.locator('.row-label').textContent()).toBe(testTitle(FAILING));
      await page.keyboard.press('j');
      await expect.poll(() => current.locator('.row-label').textContent()).not.toBe(testTitle(FAILING));
      expect(await current.count()).toBe(1);
      await page.goto(`${urls.sample}#/tests`);
      await expect.poll(() => current.count()).toBe(0);
      await page.close();
    });
  });

  describe.each([
    [320, 180],
    [320, 256],
  ])('short viewport %ix%i, as at 400 percent zoom: the page scrolls', (width, height) => {
    const scrollY = (page: Page): Promise<number> => page.evaluate<number>('window.scrollY');
    /** Waits for the browser's smooth scroll to end: a key pressed during it can be lost. */
    const scrollSettled = (page: Page) =>
      expect
        .poll(async () => {
          const before = await scrollY(page);
          await settle(page);
          return before === (await scrollY(page));
        })
        .toBe(true);
    /** Whether an element is fully inside the viewport. */
    const inViewport = (locator: Locator): Promise<boolean> =>
      locator.first().evaluate((element) => {
        const box = element.getBoundingClientRect();
        return box.top >= 0 && box.bottom <= element.ownerDocument.documentElement.clientHeight;
      });

    it('reaches the content and scrolls it with the keyboard, without horizontal scroll', async () => {
      const { page, errors } = await open(`${urls.sample}#/`, width, { height });
      expect(await page.locator('.main').evaluate((main) => main.getBoundingClientRect().height)).toBeGreaterThan(height);
      expect(await page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')).toBe(0);
      // Nothing has focus: the browser scrolls the page, the forwarding stays out of the way.
      await page.keyboard.press('PageDown');
      await expect.poll(() => scrollY(page)).toBeGreaterThan(0);
      await scrollSettled(page);
      await page.keyboard.press('End');
      await expect.poll(() => inViewport(page.locator('.footer'))).toBe(true);
      await scrollSettled(page);
      await page.keyboard.press('Home');
      await expect.poll(() => scrollY(page)).toBe(0);
      expect(errors).toEqual([]);
      await page.close();
    });

    it('skips to the content: the heading scrolls into view', async () => {
      const { page } = await open(`${urls.sample}#/health`, width, { height });
      expect(await inViewport(heading(page))).toBe(false);
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      expect(await hasFocus(page.locator('.main'))).toBe(true);
      await expect.poll(() => inViewport(heading(page))).toBe(true);
      await page.close();
    });

    it('starts another page at the top of the content, its heading focused and in view', async () => {
      const { page } = await open(`${urls.sample}#/tests`, width, { height });
      const link = page.locator('.tests-table .cell-title > a').nth(3);
      await link.focus();
      await page.keyboard.press('Enter');
      await expect.poll(() => headingFocused(page)).toBe(true);
      expect(await inViewport(heading(page))).toBe(true);
      await page.close();
    });

    it('keeps the focused tree row in view in the sidebar overlay', async () => {
      const { page } = await open(`${urls.sample}#/`, width, { height });
      await page.getByRole('button', { name: 'Show sidebar' }).click();
      await page.getByRole('treeitem', { level: 1 }).first().focus();
      for (let index = 0; index < 12; index++) {
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowDown');
        expect(await inViewport(page.locator('[role="treeitem"]:focus > *'))).toBe(true);
      }
      await page.close();
    });

    it('brings the first added row into view after "show more"', async () => {
      const { page } = await open(`${urls.many}#/tests`, width, { height });
      await page.getByRole('button', { name: 'Show 100 more' }).focus();
      await page.keyboard.press('Enter');
      const added = page.locator('.tests-table tbody tr').nth(500).locator('a').first();
      await expect.poll(() => hasFocus(added)).toBe(true);
      expect(await inViewport(added)).toBe(true);
      await page.close();
    });
  });
});
