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
 * The header layout at several widths, and the Run details card of the
 * Overview, in the built renderer opened from file://, with the renderer
 * sample given git, CI and shard metadata.
 */

const RENDERER = path.join(ROOT, 'dist/renderer/index.html');
const SAMPLE = path.join(ROOT, 'src/renderer/dev/sample.json');
const COMMIT = '4fe7a5e1c2d3b4a5968778695a4b3c2d1e0f9a8b';
const LONG_TITLE = 'A very long suite name for the checkout and payment flows of the storefront';

/** Records copied texts instead of the real clipboard. */
const CLIPBOARD_STUB = `
  window.__copied = [];
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: (text) => { window.__copied.push(text); return Promise.resolve(); } },
  });
`;
const NO_CLIPBOARD = "Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });";

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

describe('header and run details in a browser (file://)', { timeout: 60_000 }, () => {
  let browser: Browser;
  let workDir: string;
  let report: LoupeReport;
  const urls: Record<string, string> = {};

  function writeReport(name: string, data: LoupeReport, title: string): string {
    const file = path.join(workDir, `${name}.html`);
    writeFileSync(file, injectSettings(injectData(readFileSync(RENDERER, 'utf8'), data), { ...DEFAULT_RENDERER_SETTINGS, title }));
    return pathToFileURL(file).href;
  }

  async function open(url: string, options: { width?: number; init?: string } = {}): Promise<{ page: Page; errors: string[] }> {
    const context = await browser.newContext({ viewport: { width: options.width ?? 1300, height: 800 } });
    if (options.init) await context.addInitScript({ content: options.init });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && !isMissingAttachmentFile(message, page)) errors.push(message.text());
    });
    await page.goto(url);
    await page.locator('.header').waitFor();
    return { page, errors };
  }

  beforeAll(async () => {
    assertBuilt();
    workDir = mkdtempSync(path.join(tmpdir(), 'loupe-overview-'));
    report = JSON.parse(readFileSync(SAMPLE, 'utf8')) as LoupeReport;
    report.run.git = { commit: COMMIT, branch: 'feature/media-viewers', remote: 'https://github.com/qartisan/playwright-loupe' };
    report.run.environment = { ...report.run.environment, name: 'staging', ci: true, ciProvider: 'github-actions' };
    report.run.shard = { current: 2, total: 4 };
    urls['short'] = writeReport('short', report, 'Sample run');
    urls['long'] = writeReport('long', report, LONG_TITLE);
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  const boxes = (page: Page): Promise<Record<'header' | 'identity' | 'counts' | 'meta' | 'tools', Box> & { paddingRight: number; overflow: number }> =>
    page.evaluate(`(() => {
      const box = (selector) => {
        const { left, top, right, bottom } = document.querySelector(selector).getBoundingClientRect();
        return { left, top, right, bottom };
      };
      return {
        header: box('.header'),
        identity: box('.header-identity'),
        counts: box('.header .counts'),
        meta: box('.header .run-meta'),
        tools: box('.header-tools'),
        paddingRight: parseFloat(getComputedStyle(document.querySelector('.header')).paddingRight),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    })()`);

  for (const title of ['short', 'long'] as const) {
    it.each([1600, 1100, 900, 750, 600, 480, 360])(`keeps the controls top-right and the groups in order at %ipx (${title} title)`, async (width) => {
      const { page, errors } = await open(urls[title]!, { width });
      const { header, identity, counts, meta, tools, paddingRight, overflow } = await boxes(page);
      // Controls: first row, right edge of the header.
      expect(tools.top).toBe(identity.top);
      expect(tools.right).toBe(header.right - paddingRight);
      // Groups: in reading order, all left of the controls.
      const groups = [identity, counts, meta];
      for (let index = 1; index < groups.length; index++) {
        const [previous, current] = [groups[index - 1]!, groups[index]!];
        const sameRow = current.top < previous.bottom;
        expect(sameRow ? current.left >= previous.right : current.top >= previous.bottom).toBe(true);
      }
      for (const group of groups) expect(group.right).toBeLessThanOrEqual(tools.left);
      expect(overflow).toBe(0);
      expect(errors).toEqual([]);
      await page.close();
    });
  }

  it('truncates a long suite name, keeping the full name in the tooltip and the accessible name', async () => {
    const { page } = await open(urls['long']!, { width: 600 });
    const link = page.locator('.header .title');
    expect(await link.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    expect(await link.getAttribute('title')).toBe(LONG_TITLE);
    expect(await page.getByRole('link', { name: LONG_TITLE }).count()).toBe(1);
    await page.close();
  });

  it('has no horizontal page scroll down to 320px', async () => {
    for (const width of [320, 340]) {
      for (const hash of ['#/', '#/tests', '#/errors', '#/health']) {
        const { page } = await open(`${urls['long']}${hash}`, { width });
        await page.locator('.page').waitFor();
        expect([width, hash, (await boxes(page)).overflow]).toEqual([width, hash, 0]);
        await page.close();
      }
    }
  });

  it('keeps the start date and the environment in the header, without branch or commit', async () => {
    const { page } = await open(urls['short']!);
    const meta = page.locator('.header .run-meta');
    expect(await meta.locator('dt').allTextContents()).toEqual(['Run', 'Environment']);
    expect(await meta.textContent()).not.toContain(COMMIT.slice(0, 7));
    await page.close();
  });

  it('shows the run details on the Overview in three groups, each a description list under its heading', async () => {
    const { page, errors } = await open(urls['short']!);
    const card = page.getByRole('region', { name: 'Run details' });
    await card.waitFor();
    expect(await card.locator('h3').allTextContents()).toEqual(['Run', 'Code', 'Environment']);
    const labels = (name: string) => card.locator(`dl[aria-labelledby="run-details-${name.toLowerCase()}"] > div > dt`).allTextContents();
    expect(await labels('Run')).toEqual(['Scope', 'CI', 'Workers', 'Shard']);
    expect(await labels('Code')).toEqual(['Commit', 'Branch', 'Repository']);
    expect(await labels('Environment')).toEqual(['Playwright', 'Loupe', 'Node', 'OS']);
    // Each <dl> is named by its heading.
    for (const name of ['Run', 'Code', 'Environment']) {
      const id = await card.locator('h3', { hasText: name }).getAttribute('id');
      expect(await card.locator(`dl[aria-labelledby="${id}"]`).count()).toBe(1);
    }
    expect(await card.locator('dl > div > dd').count()).toBe(11);
    const value = (label: string) => card.locator('dl > div', { has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) }).locator('dd');
    // The sample is a partial run, filtered with --grep-invert.
    expect(report.run.scopeReasons).toEqual(['grep']);
    expect(await value('Scope').textContent()).toBe('Partial run: grep filter');
    expect(await value('Shard').textContent()).toBe('2 of 4');
    expect(await value('CI').textContent()).toBe('GitHub Actions');
    expect(await value('Repository').locator('a').count()).toBe(0);
    const commit = value('Commit').locator('code');
    expect(await commit.textContent()).toBe('4fe7a5e');
    expect(await commit.getAttribute('title')).toBe(COMMIT);
    // It comes after the projects.
    expect((await page.locator('.view-overview > section > h2').allTextContents()).slice(-2)).toEqual(['Projects', 'Run details']);
    expect(errors).toEqual([]);
    await page.close();
  });

  it('shows the groups side by side when there is room, stacked on narrow screens', async () => {
    for (const [width, columns] of [[1300, 3], [480, 1]] as const) {
      const { page } = await open(urls['short']!, { width });
      const tops = await page.locator('.run-details-group').evaluateAll((elements) => elements.map((element) => Math.round(element.getBoundingClientRect().top)));
      expect(tops).toHaveLength(3);
      expect(new Set(tops).size).toBe(columns === 3 ? 1 : 3);
      if (columns === 1) expect([...tops].sort((a, b) => a - b)).toEqual(tops);
      expect((await boxes(page)).overflow).toBe(0);
      await page.close();
    }
  });

  it('copies the full commit hash, with the fallback dialog when the Clipboard API is missing', async () => {
    const { page } = await open(urls['short']!, { init: CLIPBOARD_STUB });
    const button = page.getByRole('button', { name: 'Copy commit hash' });
    await button.click();
    await expect.poll(() => page.evaluate<string[]>('window.__copied')).toEqual([COMMIT]);
    await expect.poll(() => page.getByRole('status').textContent()).toContain('Commit hash copied to the clipboard.');
    await page.close();

    const fallback = await open(urls['short']!, { init: NO_CLIPBOARD });
    await fallback.page.getByRole('button', { name: 'Copy commit hash' }).click();
    const dialog = fallback.page.getByRole('dialog', { name: 'Copy commit hash' });
    await dialog.waitFor();
    expect(await dialog.getByRole('textbox').inputValue()).toBe(COMMIT);
    await fallback.page.close();
  });

  it('hides empty fields, and a group without any field', async () => {
    const bare = {
      ...report,
      run: { ...report.run, scope: 'full', scopeReasons: [], shard: null, git: { commit: null, branch: null, remote: null }, environment: { ...report.run.environment, ci: false, ciProvider: null } },
    } as LoupeReport;
    const { page } = await open(writeReport('bare', bare, 'Bare run'));
    const card = page.getByRole('region', { name: 'Run details' });
    await card.waitFor();
    expect(await card.locator('h3').allTextContents()).toEqual(['Run', 'Environment']);
    expect(await card.locator('dl').count()).toBe(2);
    expect(await card.locator('dt').allTextContents()).toEqual(['Scope', 'CI', 'Workers', 'Playwright', 'Loupe', 'Node', 'OS']);
    expect(await card.textContent()).not.toMatch(/null|unknown|—/);
    expect(await card.locator('dd').first().textContent()).toBe('Full run');
    await page.close();
  });
});
