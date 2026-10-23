import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RENDERER_SETTINGS, injectData, injectSettings } from '../src/core/inject.js';
import type { LoupeReport } from '../src/schema/v1.js';
import { ROOT, assertBuilt } from './helpers/fixtures.js';

/**
 * Single-key shortcuts in the built renderer opened from file://: the view
 * shortcuts, Caps Lock, the keys removed, and the switch that turns them off
 * (WCAG 2.1.4).
 */

const RENDERER = path.join(ROOT, 'dist/renderer/index.html');
const SAMPLE = path.join(ROOT, 'src/renderer/dev/sample.json');
const SUITE = 'Storefront';
const FLAKY = 'c2cd6f823ac2cec4';
const NO_STORAGE = "Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage disabled'); } });";

describe('single-key shortcuts (file://)', { timeout: 30_000 }, () => {
  let browser: Browser;
  let workDir: string;
  let url: string;

  async function open(hash: string, context?: BrowserContext): Promise<Page> {
    const page = await (context ?? (await browser.newContext({ viewport: { width: 1300, height: 800 } }))).newPage();
    await page.goto(`${url}${hash}`);
    await page.locator('.main h1').first().waitFor();
    return page;
  }

  const headingFocused = (page: Page): Promise<boolean> => page.locator('.main h1').evaluate((element) => element === element.ownerDocument.activeElement);
  /** Waits two frames: past the effects of what a key would have done. */
  const settle = (page: Page): Promise<unknown> => page.evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');

  beforeAll(async () => {
    assertBuilt();
    workDir = mkdtempSync(path.join(tmpdir(), 'loupe-shortcuts-'));
    const report = JSON.parse(readFileSync(SAMPLE, 'utf8')) as LoupeReport;
    const file = path.join(workDir, 'sample.html');
    writeFileSync(file, injectSettings(injectData(readFileSync(RENDERER, 'utf8'), report), { ...DEFAULT_RENDERER_SETTINGS, title: SUITE }));
    url = pathToFileURL(file).href;
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it('opens a view with o, e, h and t, from anywhere, and focuses its heading', async () => {
    const page = await open(`#/test/${FLAKY}`);
    for (const [key, view] of [['t', 'Tests'], ['h', 'Suite health'], ['e', 'Errors'], ['o', 'Overview']] as const) {
      await page.keyboard.press(key);
      await expect.poll(() => page.title()).toBe(`${view} · ${SUITE}`);
      expect(await headingFocused(page)).toBe(true);
      expect(await page.locator('.main h1').textContent()).toBe(view);
    }
    await page.context().close();
  });

  it('works with Caps Lock, not with Shift, Ctrl+Alt (AltGr on Windows) or a removed key', async () => {
    const page = await open('#/');
    for (const press of ['Shift+H', 'Control+Alt+h', '[', ']', 'n', 'p']) {
      await page.keyboard.press(press);
      await settle(page);
      expect(await page.title(), press).toBe(`Overview · ${SUITE}`);
    }
    // Caps Lock: the letter arrives in upper case, without Shift.
    await page.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'H', code: 'KeyH', modifierCapsLock: true, bubbles: true, cancelable: true }))");
    await expect.poll(() => page.title()).toBe(`Suite health · ${SUITE}`);
    await page.context().close();
  });

  it('turns single-key shortcuts off from the shortcuts dialog, keeping Escape and the arrow keys, and remembers it', async () => {
    const context = await browser.newContext({ viewport: { width: 1300, height: 800 } });
    const page = await open('#/', context);
    const opener = page.getByRole('button', { name: 'Keyboard shortcuts' });
    expect(await opener.getAttribute('aria-keyshortcuts')).toBe('?');
    await opener.click();
    const toggle = page.getByRole('checkbox', { name: 'Single-key shortcuts' });
    expect(await toggle.isChecked()).toBe(true);
    expect(await page.getByRole('dialog').textContent()).toContain('j, k, o, e, h, t, / and ?');
    await toggle.uncheck();
    // Escape still closes the dialog.
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.locator('body').focus();
    for (const key of ['h', 't', '/', '?', 'j']) await page.keyboard.press(key);
    await settle(page);
    expect(await page.title()).toBe(`Overview · ${SUITE}`);
    expect(await page.locator('dialog[open]').count()).toBe(0);
    expect(await page.locator('#sidebar-search').evaluate((input) => input === input.ownerDocument.activeElement)).toBe(false);
    // No shortcut announced where none works; the search hint is gone.
    expect(await page.locator('[aria-keyshortcuts]').count()).toBe(0);
    expect(await page.locator('.search-key').count()).toBe(0);
    // The arrow keys still work in the sidebar.
    await page.locator('.nav-link[tabindex="0"]').focus();
    await page.keyboard.press('ArrowDown');
    expect(await page.locator('.nav-link', { hasText: 'Errors' }).evaluate((link) => link === link.ownerDocument.activeElement)).toBe(true);

    // Remembered on reload; back on from the dialog.
    await page.reload();
    await page.locator('.main h1').waitFor();
    await page.keyboard.press('h');
    await settle(page);
    expect(await page.title()).toBe(`Overview · ${SUITE}`);
    await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
    expect(await page.getByRole('checkbox', { name: 'Single-key shortcuts' }).isChecked()).toBe(false);
    await page.getByRole('checkbox', { name: 'Single-key shortcuts' }).check();
    await page.keyboard.press('Escape');
    await page.locator('body').focus();
    await page.keyboard.press('h');
    await expect.poll(() => page.title()).toBe(`Suite health · ${SUITE}`);
    await context.close();
  });

  it('starts on without localStorage, and the switch still works for the page', async () => {
    const context = await browser.newContext({ viewport: { width: 1300, height: 800 } });
    await context.addInitScript({ content: NO_STORAGE });
    const page = await open('#/', context);
    await page.keyboard.press('h');
    await expect.poll(() => page.title()).toBe(`Suite health · ${SUITE}`);
    await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
    await page.getByRole('checkbox', { name: 'Single-key shortcuts' }).uncheck();
    await page.keyboard.press('Escape');
    await page.locator('body').focus();
    await page.keyboard.press('o');
    await settle(page);
    expect(await page.title()).toBe(`Suite health · ${SUITE}`);
    await context.close();
  });
});
