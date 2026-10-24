import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RENDERER_SETTINGS, injectData, injectSettings } from '../src/core/inject.js';
import type { LoupeReport } from '../src/schema/v1.js';
import { ROOT, assertBuilt, isMissingAttachmentFile } from './helpers/fixtures.js';

/**
 * The application shell, in the built renderer opened from file://. Above
 * 480 px of height the document never scrolls: the sidebar and the content
 * scroll in their own box, whatever the wheel, the keyboard or a focus move
 * does. At 480 px or less (400 % zoom) the page scrolls as a whole on purpose
 * (WCAG 1.4.10), without ever showing empty space.
 *
 * Scrollbars are rendered as classic ones: headless Chromium hides them by
 * default (`--hide-scrollbars`), which would hide a second scrollbar.
 */

const RENDERER = path.join(ROOT, 'dist/renderer/index.html');
const SAMPLE = path.join(ROOT, 'src/renderer/dev/sample.json');

type Viewport = { width: number; height: number };
const SHELL: Array<[string, Viewport]> = [
  ['1280x720', { width: 1280, height: 720 }],
  ['640x720 (narrow, sidebar as a drawer)', { width: 640, height: 720 }],
];
const SHORT: Array<[string, Viewport]> = [
  ['1280x400', { width: 1280, height: 400 }],
  ['640x360', { width: 640, height: 360 }],
];
const THEMES = ['light', 'dark'] as const;
/** Long views: the Overview, the skipped tests of Suite health, the Tests table. */
const VIEWS = ['#/', '#/health', '#/tests'];

/** Elements of the shell that could scroll, besides the document; only the two panes may. */
const SHELL_ELEMENTS = ['#app', '.app', '.layout', '.sidebar', '.sidebar-scroll', '.main'];

describe('application shell (file://)', { timeout: 60_000 }, () => {
  let browser: Browser;
  let workDir: string;
  let url: string;

  async function open(hash: string, viewport: Viewport, colorScheme: 'light' | 'dark' = 'light'): Promise<{ page: Page; errors: string[] }> {
    const page = await browser.newPage({ viewport, colorScheme });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && !isMissingAttachmentFile(message, page)) errors.push(message.text());
    });
    await page.goto(`${url}${hash}`);
    await page.locator('.main h1').first().waitFor();
    return { page, errors };
  }

  /** Opens the sidebar when it starts closed (the narrow drawer), then expands every group of the tree. */
  async function showWholeTree(page: Page): Promise<void> {
    if (await page.locator('#sidebar').isHidden()) await page.locator('.masthead [aria-controls="sidebar"]').click();
    await page.getByRole('button', { name: 'Expand all' }).click();
  }

  /** Wheels far down over each visible pane: the middle of the sidebar, the right edge of the content (the narrow drawer covers its left part). */
  async function wheelPanes(page: Page): Promise<void> {
    for (const selector of ['.sidebar-scroll', '.main']) {
      const box = await page.locator(selector).boundingBox();
      if (!box || box.height === 0) continue;
      await page.mouse.move(selector === '.main' ? box.x + box.width - 40 : box.x + box.width / 2, box.y + box.height / 2);
      for (let index = 0; index < 20; index++) await page.mouse.wheel(0, 5000);
    }
    await settle(page);
  }

  /** Waits two frames, past the scroll and the effects of a render. */
  const settle = (page: Page): Promise<unknown> => page.evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');

  /** Expressions, not functions: the tests are compiled without the DOM library. */
  const documentScroll = (page: Page) =>
    page.evaluate<{ top: number; height: number; client: number; width: number; clientWidth: number }>(`(() => {
      const root = document.scrollingElement;
      return { top: root.scrollTop, height: root.scrollHeight, client: root.clientHeight, width: root.scrollWidth, clientWidth: root.clientWidth };
    })()`);

  /** Bottom edges of the visible panes, rounded. */
  const paneBottoms = (page: Page) =>
    page.evaluate<number[]>(`['.sidebar', '.main']
      .map((selector) => document.querySelector(selector))
      .filter((element) => !element.hidden)
      .map((element) => Math.round(element.getBoundingClientRect().bottom))`);

  /** Shell elements showing a vertical scrollbar: wider than their content box by more than their borders. */
  const verticalScrollbars = (page: Page) =>
    page.evaluate<string[]>(`(() => {
      const found = [];
      if (window.innerWidth > document.documentElement.clientWidth) found.push('document');
      for (const selector of ${JSON.stringify(SHELL_ELEMENTS)}) {
        const element = document.querySelector(selector);
        if (element.hidden) continue;
        const style = getComputedStyle(element);
        const scrollbar = element.offsetWidth - element.clientWidth - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth);
        if (scrollbar > 0) found.push(selector);
      }
      return found;
    })()`);

  /** The document scroll in the app shell: never scrolled, never taller than the viewport. */
  async function expectLockedDocument(page: Page, viewport: Viewport): Promise<void> {
    const scroll = await documentScroll(page);
    expect(scroll.top).toBe(0);
    expect(scroll.height).toBeLessThanOrEqual(scroll.client);
    expect(await paneBottoms(page)).toEqual(expect.arrayContaining([viewport.height]));
    for (const bottom of await paneBottoms(page)) expect(bottom).toBe(viewport.height);
  }

  beforeAll(async () => {
    assertBuilt();
    workDir = mkdtempSync(path.join(tmpdir(), 'loupe-shell-'));
    const sample = JSON.parse(readFileSync(SAMPLE, 'utf8')) as LoupeReport;
    // Long enough for every view and the expanded tree to overflow their pane many times over.
    const tests = Array.from({ length: 600 }, (_, index) => {
      const test = sample.tests[index % sample.tests.length]!;
      return { ...test, id: index.toString(16).padStart(16, '0'), title: `${test.title} #${index}`, file: `specs/area-${index % 12}/${test.file}` };
    });
    const file = path.join(workDir, 'many.html');
    writeFileSync(file, injectSettings(injectData(readFileSync(RENDERER, 'utf8'), { ...sample, tests }), DEFAULT_RENDERER_SETTINGS));
    url = pathToFileURL(file).href;
    browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  describe.each(SHELL)('app shell at %s', (_, viewport) => {
    it.each(THEMES)('keeps the document still when the wheel reaches the end of each pane (%s theme)', async (theme) => {
      for (const hash of VIEWS) {
        const { page, errors } = await open(hash, viewport, theme);
        await showWholeTree(page);
        await wheelPanes(page);
        await expectLockedDocument(page, viewport);
        // The panes did scroll: the wheel reached them.
        expect(await page.locator('.main').evaluate((main) => main.scrollTop)).toBeGreaterThan(0);
        expect(await page.locator('.sidebar-scroll').evaluate((pane) => pane.scrollTop)).toBeGreaterThan(0);
        expect(errors).toEqual([]);
        await page.close();
      }
    });

    it.each(THEMES)('keeps the document still on End in the tree and when focusing the last test row (%s theme)', async (theme) => {
      const { page } = await open('#/tests', viewport, theme);
      await showWholeTree(page);
      await page.locator('[role="treeitem"][tabindex="0"]').focus();
      await page.keyboard.press('End');
      await settle(page);
      expect(await page.locator('[role="treeitem"]').last().evaluate((row) => row === row.ownerDocument.activeElement)).toBe(true);
      await expectLockedDocument(page, viewport);
      // On the narrow layout, the drawer covers the table: the content is still focusable behind it.
      await page.locator('.tests-table tbody tr').last().locator('a').first().focus();
      await settle(page);
      expect(await page.locator('.main').evaluate((main) => main.scrollTop)).toBeGreaterThan(0);
      await expectLockedDocument(page, viewport);
      await page.close();
    });

    it('keeps the document still when the page scrolls to an error category, and when a project card reveals its group', async () => {
      const { page } = await open('#/', viewport);
      await page.locator('.project-card').last().click();
      await expect.poll(() => page.locator('.tree-row.revealed').count()).toBe(1);
      await expectLockedDocument(page, viewport);
      await page.evaluate("location.hash = '#/errors/category/Timeout'");
      await expect.poll(() => page.evaluate<string>('document.activeElement.closest("[data-category]")?.dataset.category ?? ""')).toBe('Timeout');
      await expectLockedDocument(page, viewport);
      await page.close();
    });

    it('shows no document scrollbar, and at most one per pane, with classic scrollbars', async () => {
      for (const hash of VIEWS) {
        const { page } = await open(hash, viewport);
        await showWholeTree(page);
        expect(await page.evaluate<boolean>('window.innerWidth === document.documentElement.clientWidth')).toBe(true);
        expect((await documentScroll(page)).height).toBeLessThanOrEqual((await documentScroll(page)).client);
        // Only the panes scroll, each with its own single scrollbar.
        expect(await verticalScrollbars(page)).toEqual(['.sidebar-scroll', '.main']);
        await page.close();
      }
    });

    it('keeps the wheel inside the panes even when the document can scroll', async () => {
      const { page } = await open('#/tests', viewport);
      // A future layout bug: the document unlocked and taller than the viewport.
      await page.addStyleTag({ content: 'html, body { overflow: visible !important; } body::after { content: ""; display: block; height: 2000px; }' });
      await showWholeTree(page);
      expect((await documentScroll(page)).height).toBeGreaterThan(viewport.height);
      await wheelPanes(page);
      expect((await documentScroll(page)).top).toBe(0);
      await page.close();
    });

    it('fits the document in the viewport without the overflow lock: the panes contain their content', async () => {
      for (const hash of VIEWS) {
        const { page } = await open(hash, viewport);
        await page.addStyleTag({ content: 'html, body { overflow: visible !important; }' });
        await showWholeTree(page);
        const scroll = await documentScroll(page);
        expect(scroll.height, hash).toBeLessThanOrEqual(scroll.client);
        await page.close();
      }
    });
  });

  it('keeps the narrow sidebar a drawer over the content, the full height of the layout', async () => {
    const { page } = await open('#/tests', { width: 640, height: 720 });
    expect(await page.locator('#sidebar').isHidden()).toBe(true);
    await page.locator('.masthead [aria-controls="sidebar"]').click();
    const layout = (await page.locator('.layout').boundingBox())!;
    const sidebar = (await page.locator('#sidebar').boundingBox())!;
    const main = (await page.locator('.main').boundingBox())!;
    expect(await page.evaluate<string>("getComputedStyle(document.querySelector('#sidebar')).position")).toBe('absolute');
    // Over the content, which keeps the full width.
    expect(sidebar.x).toBe(0);
    expect(main.x).toBe(0);
    expect(main.width).toBe(640);
    expect([sidebar.y, sidebar.y + sidebar.height]).toEqual([layout.y, 720]);
    await page.close();
  });

  describe.each(SHORT)('short screen at %s: the page scrolls as a whole', (_, viewport) => {
    it.each(THEMES)('scrolls to the end of the content, never past it, without horizontal scroll (%s theme)', async (theme) => {
      for (const hash of VIEWS) {
        const { page, errors } = await open(hash, viewport, theme);
        await showWholeTree(page);
        await page.mouse.move(viewport.width - 20, viewport.height / 2);
        for (let index = 0; index < 40; index++) await page.mouse.wheel(0, 5000);
        await settle(page);
        const scroll = await documentScroll(page);
        expect(scroll.height, hash).toBeGreaterThan(scroll.client);
        expect(scroll.top + scroll.client, hash).toBe(scroll.height);
        // The lowest pane ends at the bottom of the viewport: no empty space below the content.
        expect(Math.max(...(await paneBottoms(page))), hash).toBe(viewport.height);
        expect(scroll.width, hash).toBeLessThanOrEqual(scroll.clientWidth);
        expect(errors).toEqual([]);
        await page.close();
      }
    });
  });
});
