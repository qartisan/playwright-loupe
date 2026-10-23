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
 * Forced colours (Chromium's emulation of Windows high contrast) and reduced
 * motion, in the built renderer opened from file://.
 */

const RENDERER = path.join(ROOT, 'dist/renderer/index.html');
const SAMPLE = path.join(ROOT, 'src/renderer/dev/sample.json');
const FLAKY = 'c2cd6f823ac2cec4';
const COMPARISON = 'f49e1c79155fa7f4';

describe('display modes (file://)', { timeout: 30_000 }, () => {
  let browser: Browser;
  let workDir: string;
  let url: string;

  async function open(hash: string, options: { forcedColors?: 'active' | 'none'; colorScheme?: 'light' | 'dark'; reducedMotion?: 'reduce' | 'no-preference' } = {}): Promise<Page> {
    const page = await browser.newPage({
      viewport: { width: 1300, height: 800 },
      forcedColors: options.forcedColors ?? 'none',
      colorScheme: options.colorScheme ?? 'light',
      reducedMotion: options.reducedMotion ?? 'no-preference',
    });
    await page.goto(`${url}${hash}`);
    await page.locator('.main h1').first().waitFor();
    return page;
  }

  /** Computed colours of the first element matching `selector`. */
  const colors = (page: Page, selector: string): Promise<{ color: string; background: string; outline: string }> =>
    page.locator(selector).first().evaluate((element) => {
      const style = element.ownerDocument.defaultView!.getComputedStyle(element);
      return { color: style.color, background: style.backgroundColor, outline: `${style.outlineStyle} ${style.outlineColor}` };
    });

  /** The value a system colour resolves to on this page. */
  const systemColor = (page: Page, name: string): Promise<string> =>
    page.evaluate<string>(`(() => {
      const probe = document.createElement('span');
      probe.style.color = ${JSON.stringify(name)};
      document.body.append(probe);
      const value = getComputedStyle(probe).color;
      probe.remove();
      return value;
    })()`);

  const CANVAS = 'getComputedStyle(document.body).backgroundColor';

  beforeAll(async () => {
    assertBuilt();
    workDir = mkdtempSync(path.join(tmpdir(), 'loupe-modes-'));
    const report = JSON.parse(readFileSync(SAMPLE, 'utf8')) as LoupeReport;
    const file = path.join(workDir, 'sample.html');
    writeFileSync(file, injectSettings(injectData(readFileSync(RENDERER, 'utf8'), report), DEFAULT_RENDERER_SETTINGS));
    url = pathToFileURL(file).href;
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  describe.each(['light', 'dark'] as const)('forced colours, %s system palette', (colorScheme) => {
    it.each([
      ['theme switch', '#/', '.theme-switch [aria-pressed="true"]', '.theme-switch [aria-pressed="false"]'],
      ['attempt tab', `#/test/${FLAKY}`, '.attempt-tab[aria-selected="true"]', '.attempt-tab[aria-selected="false"]'],
      ['steps toggle', `#/test/${FLAKY}?steps=all`, '.section-head [aria-pressed="true"]', '.copy-button'],
      ['comparison mode', `#/test/${COMPARISON}`, '.cmp-modes [aria-pressed="true"]', '.cmp-modes [aria-pressed="false"]'],
      ['active test chip', '#/tests?tag=%40smoke', '.test-chip-active', '.test-chip:not(.test-chip-active)'],
      ['current view in the sidebar', '#/', '.nav-link[aria-current="page"]', '.nav-link:not([aria-current])'],
      ['current test in the tree', `#/test/${FLAKY}`, '.tree-test[aria-selected="true"]', '.tree-test[aria-selected="false"]'],
    ])('shows the %s state in system colours', async (_, hash, on, off) => {
      const page = await open(hash, { forcedColors: 'active', colorScheme });
      const [highlight, highlightText] = await Promise.all([systemColor(page, 'Highlight'), systemColor(page, 'HighlightText')]);
      const [selected, other] = await Promise.all([colors(page, on), colors(page, off)]);
      expect(selected.background).toBe(highlight);
      expect(selected.color).toBe(highlightText);
      expect(other.background).not.toBe(highlight);
      // The text inside is HighlightText too, links and icons included.
      const inner = await page
        .locator(on)
        .first()
        .evaluate((element) => [...element.querySelectorAll('*')].map((child) => element.ownerDocument.defaultView!.getComputedStyle(child).color));
      expect(inner.filter((color) => color !== highlightText)).toEqual([]);
      await page.close();
    });

    it('keeps the colours of bar segments, outlined in CanvasText', async () => {
      const page = await open('#/', { forcedColors: 'active', colorScheme });
      const canvas = await page.evaluate<string>(CANVAS);
      const canvasText = await systemColor(page, 'CanvasText');
      for (const selector of ['.outcome-bar-part', '.category-bar']) {
        const segments = await page.locator(selector).evaluateAll((elements) =>
          elements.map((element) => {
            const style = element.ownerDocument.defaultView!.getComputedStyle(element);
            return { background: style.backgroundColor, outline: `${style.outlineStyle} ${style.outlineColor}`, width: element.getBoundingClientRect().width };
          }),
        );
        expect(segments.length).toBeGreaterThan(0);
        for (const segment of segments) {
          expect(segment.background).not.toBe(canvas);
          expect(segment.outline).toBe(`solid ${canvasText}`);
          expect(segment.width).toBeGreaterThan(0);
        }
        // Each status its own colour.
        if (selector === '.outcome-bar-part') expect(new Set(segments.map((segment) => segment.background)).size).toBe(segments.length);
      }
      await page.close();
    });

    it('draws focus rings in Highlight', async () => {
      const page = await open('#/tests', { forcedColors: 'active', colorScheme });
      const highlight = await systemColor(page, 'Highlight');
      for (let index = 0; index < 4; index++) {
        await page.keyboard.press('Tab');
        expect(await page.evaluate<string>('`${getComputedStyle(document.activeElement).outlineStyle} ${getComputedStyle(document.activeElement).outlineColor}`')).toBe(`solid ${highlight}`);
      }
      await page.close();
    });
  });

  it('keeps the slider divider visible in forced colours', async () => {
    const page = await open('#/', { forcedColors: 'active' });
    // No comparison images in this report: the rule itself, on a divider added to the page.
    const divider = await page.evaluate<{ adjust: string; background: string }>(`(() => {
      const element = document.createElement('span');
      element.className = 'cmp-divider';
      document.querySelector('.main').append(element);
      const style = getComputedStyle(element);
      return { adjust: style.getPropertyValue('forced-color-adjust'), background: style.backgroundColor };
    })()`);
    expect(divider.adjust).toBe('none');
    expect(divider.background).not.toBe(await page.evaluate<string>(CANVAS));
    await page.close();
  });

  describe('reduced motion', () => {
    const chevron = (page: Page): Promise<string> =>
      page.locator('.chevron').first().evaluate((element) => element.ownerDocument.defaultView!.getComputedStyle(element).transitionDuration);

    it('turns off every transition, and smooth scrolling, under prefers-reduced-motion', async () => {
      const page = await open('#/', { reducedMotion: 'reduce' });
      expect(await chevron(page)).toBe('0s');
      // Any element, now or later: the rule is global.
      const probe = await page.evaluate<string[]>(`(() => {
        const element = document.createElement('div');
        element.style.transition = 'opacity 2s 1s';
        element.style.animation = 'spin 3s infinite';
        element.style.scrollBehavior = 'smooth';
        document.body.append(element);
        const style = getComputedStyle(element);
        return [style.transitionDuration, style.transitionDelay, style.animationDuration, style.animationIterationCount, style.scrollBehavior];
      })()`);
      expect(probe).toEqual(['0s', '0s', '0s', '1', 'auto']);
      await page.close();
    });

    it('keeps them otherwise', async () => {
      const page = await open('#/');
      expect(await chevron(page)).toBe('0.1s');
      await page.close();
    });
  });
});
