import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RENDERER_SETTINGS, injectData, injectSettings } from '../src/core/inject.js';
import type { LoupeReport } from '../src/schema/v1.js';
import { ROOT, assertBuilt } from './helpers/fixtures.js';

/**
 * The header in the built renderer, with and without the partial run pill:
 * nothing overflows or overlaps, the sidebar toggle keeps its size and place,
 * the pill sits on the line of the status, and the header meets the sidebar
 * and the content directly (no banner between them).
 */

const RENDERER = path.join(ROOT, 'dist/renderer/index.html');
const SAMPLE = path.join(ROOT, 'src/renderer/dev/sample.json');

type Viewport = { width: number; height: number };
const VIEWPORTS: Array<[string, Viewport]> = [
  ['1280x720', { width: 1280, height: 720 }],
  ['640x720', { width: 640, height: 720 }],
  ['360x720', { width: 360, height: 720 }],
  ['1280x400', { width: 1280, height: 400 }],
];
const THEMES = ['light', 'dark'] as const;
/** Same breakpoint as styles.css: below it the pill says "Partial" alone. */
const SHORT_PILL_MAX = 440;

type Dataset = 'partial' | 'long' | 'full';
/** The sample is partial (grep); `long` has the longest reason and several others; `full` has none. */
const PILL: Record<Dataset, string | null> = {
  partial: 'Partial: grep filter',
  long: 'Partial: LOUPE_RUN_SCOPE=partial +3',
  full: null,
};

/** Parts of the header that must never overlap. */
const PARTS = ['.masthead [aria-controls="sidebar"]', '.brand', '.run-status', '.scope-pill', '.counts', '.run-meta', '.header-tools'];

type Box = { x: number; y: number; width: number; height: number };

describe('header with the partial run pill (file://)', { timeout: 60_000 }, () => {
  let browser: Browser;
  let workDir: string;
  const urls = {} as Record<Dataset, string>;

  beforeAll(async () => {
    assertBuilt();
    workDir = mkdtempSync(path.join(tmpdir(), 'loupe-header-'));
    const sample = JSON.parse(readFileSync(SAMPLE, 'utf8')) as LoupeReport;
    const reports: Record<Dataset, LoupeReport> = {
      partial: sample,
      long: { ...sample, run: { ...sample.run, scopeReasons: ['env', 'file-filter', 'grep', 'project-filter'] } },
      full: { ...sample, run: { ...sample.run, scope: 'full', scopeReasons: [] } },
    };
    const template = readFileSync(RENDERER, 'utf8');
    for (const [name, report] of Object.entries(reports) as Array<[Dataset, LoupeReport]>) {
      const file = path.join(workDir, `${name}.html`);
      writeFileSync(file, injectSettings(injectData(template, report), DEFAULT_RENDERER_SETTINGS));
      urls[name] = pathToFileURL(file).href;
    }
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  async function open(dataset: Dataset, viewport: Viewport, colorScheme: 'light' | 'dark'): Promise<Page> {
    const page = await browser.newPage({ viewport, colorScheme });
    await page.goto(`${urls[dataset]}#/tests`);
    await page.locator('.main h1').first().waitFor();
    return page;
  }

  /** The box of the first match; null when there is none (a full run has no pill). */
  const box = async (page: Page, selector: string): Promise<Box | null> =>
    (await page.locator(selector).count()) === 0 ? null : page.locator(selector).first().boundingBox();
  const centre = (b: Box): number => b.y + b.height / 2;
  const overlaps = (a: Box, b: Box): boolean =>
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.5 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.5;
  const inside = (b: Box, viewport: Viewport): boolean => b.x >= 0 && b.y >= 0 && b.x + b.width <= viewport.width && b.y + b.height <= viewport.height;

  describe.each(VIEWPORTS)('at %s', (_, viewport) => {
    describe.each(THEMES)('%s theme', (theme) => {
      it.each(['partial', 'long', 'full'] as const)('lays out the header of a %s run', async (dataset) => {
        const page = await open(dataset, viewport, theme);
        const expected = PILL[dataset];

        // The pill on a partial run only, with its visible text: shortened on narrow headers.
        expect(await page.locator('.scope-pill').count()).toBe(expected === null ? 0 : 1);
        if (expected !== null) {
          expect(await page.locator('.scope-pill').innerText()).toBe(viewport.width <= SHORT_PILL_MAX ? 'Partial' : expected);
          expect(await page.locator('.scope-pill').getAttribute('aria-label')).toBe(`${expected}. Show details in Run details`);
        }
        expect(await page.locator('.banner, [role="note"]').count()).toBe(0);

        // No horizontal overflow.
        expect(await page.evaluate<boolean>('document.documentElement.scrollWidth <= document.documentElement.clientWidth')).toBe(true);

        // The toggle, the status and the pill in view; the toggle never squeezed.
        const toggle = (await box(page, PARTS[0]!))!;
        expect([toggle.width, toggle.height]).toEqual([30, 30]);
        expect(inside(toggle, viewport)).toBe(true);
        const status = (await box(page, '.run-status'))!;
        expect(inside(status, viewport)).toBe(true);
        const pill = await box(page, '.scope-pill');
        if (pill) {
          expect(inside(pill, viewport)).toBe(true);
          // On the line of the status, and of the toggle when they share it.
          expect(Math.abs(centre(pill) - centre(status))).toBeLessThanOrEqual(1);
          if (status.y < toggle.y + toggle.height) expect(Math.abs(centre(pill) - centre(toggle))).toBeLessThanOrEqual(1);
        }

        // No part overlaps another.
        const boxes = (await Promise.all(PARTS.map(async (selector) => [selector, await box(page, selector)] as const))).filter(
          (entry): entry is readonly [string, Box] => entry[1] !== null,
        );
        const overlapping = boxes.flatMap(([a, first], index) => boxes.slice(index + 1).filter(([, second]) => overlaps(first, second)).map(([b]) => `${a} / ${b}`));
        expect(overlapping).toEqual([]);

        // The header alone in the masthead, directly above the sidebar and the content.
        expect(await page.locator('.masthead > *').count()).toBe(1);
        const masthead = (await box(page, '.masthead'))!;
        expect((await box(page, '.layout'))!.y).toBe(masthead.y + masthead.height);
        await page.close();
      });
    });

    it('opens and closes the sidebar with the toggle, under the header', async () => {
      const page = await open('partial', viewport, 'light');
      const toggle = page.locator('.masthead [aria-controls="sidebar"]');
      const wasOpen = await page.locator('#sidebar').isVisible();
      await toggle.click();
      expect(await page.locator('#sidebar').isVisible()).toBe(!wasOpen);
      if (!wasOpen) {
        const masthead = (await box(page, '.masthead'))!;
        expect((await box(page, '#sidebar'))!.y).toBe(masthead.y + masthead.height);
      }
      await toggle.click();
      expect(await page.locator('#sidebar').isVisible()).toBe(wasOpen);
      await page.close();
    });
  });
});
