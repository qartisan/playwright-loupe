import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RENDERER_SETTINGS, injectData, injectSettings } from '../src/core/inject.js';
import type { Attachment, LoupeReport } from '../src/schema/v1.js';
import { A11Y_ALLOWLIST } from './a11y-allowlist.js';
import { audit, describeFinding, type AllowEntry, type Finding } from './helpers/axe.js';
import { cascadeReport } from './helpers/cascade.js';
import { ROOT, assertBuilt, isMissingAttachmentFile } from './helpers/fixtures.js';
import { solidPng } from './helpers/png.js';

/**
 * Accessibility matrix: axe-core (WCAG 2.0 to 2.2, A and AA, plus best
 * practices) on every view and state of the built renderer opened from
 * file://, in the light and dark themes. A `serious` or `critical` WCAG
 * violation fails; the rest is printed after the run. Accepted findings are in
 * a11y-allowlist.ts, each with its reason.
 *
 * Datasets: the renderer sample with generated media files (PNGs and a
 * recorded video at the sample's attachment paths), the cascade, and variants
 * built in code for states no run produces as is.
 *
 * Adding a state is one line in MATRIX: name, dataset, hash, and options:
 * `arrange` (what to do before the audit), `reached` (a selector present
 * once the state is shown), `width`, `height`, `init` (an init script),
 * `forcedColors`.
 */

const RENDERER = path.join(ROOT, 'dist/renderer/index.html');
const SAMPLE = path.join(ROOT, 'src/renderer/dev/sample.json');
const NO_CLIPBOARD = "Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });";

// Tests of the sample (project chromium-a).
const FLAKY = 'c2cd6f823ac2cec4';
const COMPARISON = 'f49e1c79155fa7f4';
const SCREENSHOT = '2622e3552e16fe29';
const OUTPUT = 'ceaacab5661164dc';
const SKIP_REASON = '5e43fd66e4c629e0';
const NOT_RUN = '710bcc0fe7c6b583';
const FAILING = 'e6c8105b02e8ef4c';
// Of the cascade: a test stopped by its timeout, with an error raised after it.
const AFTER_TIMEOUT = 'ccccccccccccccc4';

type Dataset = 'sample' | 'cascade' | 'noPoints' | 'tiles' | 'many' | 'missingMedia';

interface StateOptions {
  arrange?: (page: Page) => Promise<void>;
  reached?: string;
  width?: number;
  height?: number;
  init?: string;
  /** Chromium's emulation of Windows high contrast. */
  forcedColors?: boolean;
}

type State = [name: string, dataset: Dataset, hash: string, options?: StateOptions];

const click = (selector: string) => (page: Page) => page.locator(selector).first().click();
const clickText = (selector: string, text: string) => (page: Page) => page.locator(selector, { hasText: text }).first().click();
const clickAll = (selector: string) => async (page: Page) => {
  for (const element of await page.locator(selector).filter({ visible: true }).all()) await element.click();
};
const comparisonMode = (label: string): StateOptions => ({ arrange: clickText('.cmp-modes button', label), reached: '.cmp-modes [aria-pressed="true"]' });

const MATRIX: State[] = [
  // Overview
  ['overview: failure points card, run errors, partial run, run details', 'sample', '#/', { reached: '.widget-failure-points' }],
  ['overview: without the failure points card', 'noPoints', '#/', { arrange: async (page) => expect(await page.locator('.widget-failure-points').count()).toBe(0) }],
  ['overview: cascade', 'cascade', '#/', { reached: '.widget-failure-points' }],
  ['overview: sidebar collapsed', 'sample', '#/', { arrange: click('[aria-controls="sidebar"]'), reached: '#sidebar[hidden]' }],
  ['header at 1600px', 'sample', '#/', { width: 1600 }],
  ['header at 360px', 'sample', '#/', { width: 360 }],
  ['header at 360px, sidebar open', 'sample', '#/', { width: 360, arrange: click('[aria-controls="sidebar"]'), reached: '#sidebar:not([hidden])' }],
  // 400 % zoom of 1280×720 and 1280×1024: the page scrolls as a whole.
  ['overview at 320x180', 'sample', '#/', { width: 320, height: 180 }],
  ['overview at 320x256', 'sample', '#/', { width: 320, height: 256 }],
  ['sidebar open at 320x180', 'sample', '#/', { width: 320, height: 180, arrange: click('[aria-controls="sidebar"]'), reached: '#sidebar:not([hidden])' }],
  ['tests at 320x256', 'sample', '#/tests', { width: 320, height: 256 }],
  ['test detail at 320x180', 'sample', `#/test/${FAILING}`, { width: 320, height: 180, reached: '.code-snippet' }],
  // Errors
  ['errors: run errors, groups, categories', 'sample', '#/errors'],
  ['errors: folded groups collapsed', 'cascade', '#/errors', { reached: 'details.after-timeout:not([open])' }],
  ['errors: folded groups expanded', 'cascade', '#/errors', { arrange: clickAll('details.after-timeout > summary'), reached: 'details.after-timeout[open]' }],
  ['errors: category', 'sample', '#/errors/category/Timeout'],
  ['error group with previous / next', 'cascade', '#/group/a1c0de000001', { reached: '.pager' }],
  // Suite health
  ['health: dimension bars, slowest, flaky, skipped with reasons and not run', 'sample', '#/health'],
  ['health: exact tables expanded', 'sample', '#/health', { arrange: clickAll('details.dimension-table > summary'), reached: 'details.dimension-table[open]' }],
  ['health: dimension tiles', 'tiles', '#/health', { reached: '[data-representation="tiles"]' }],
  ['health: tile details on focus', 'tiles', '#/health', { arrange: (page) => page.locator('.dimension-tile').first().focus(), reached: '.tile-details:not([hidden])' }],
  // Tests view
  ['tests', 'sample', '#/tests'],
  ['tests at 360px', 'sample', '#/tests', { width: 360 }],
  ['tests: facet menu open', 'sample', '#/tests', { arrange: click('.facets details > summary'), reached: '.facets details[open]' }],
  ['tests: active filter chips', 'sample', '#/tests?q=fails&status=failed&dim.Layer=api', { reached: '.filter-chips .chip' }],
  ['tests: +N expanded', 'many', '#/tests', { arrange: click('.test-chip-more'), reached: '.test-chip-more[aria-expanded="true"]' }],
  ['tests: empty state', 'sample', '#/tests?q=nothing-matches-this', { reached: '.empty-state' }],
  ['tests: failure point facet open', 'cascade', '#/tests', { arrange: click('.facet[data-facet="point"] > summary'), reached: '.facet[data-facet="point"][open]' }],
  ['tests: sorted column', 'sample', '#/tests?sort=duration:desc', { reached: 'th[aria-sort]' }],
  ['tests: 500-row cap', 'many', '#/tests', { reached: '.table-more' }],
  // Test detail
  ['test: flaky, attempt tabs', 'sample', `#/test/${FLAKY}`, { reached: '[role="tab"]' }],
  ['test: flaky, first attempt, text body expanded', 'sample', `#/test/${FLAKY}?attempt=0`, { arrange: clickAll('details.attachment-body > summary'), reached: 'details.attachment-body[open]' }],
  ['test: error with snippet, stack expanded', 'sample', `#/test/${FAILING}`, { arrange: clickAll('details.stack-details > summary'), reached: 'details.stack-details[open]' }],
  ['test: error at 360px', 'sample', `#/test/${FAILING}`, { width: 360, reached: '.code-snippet' }],
  ['test: all steps', 'sample', `#/test/${FAILING}?steps=all`, { reached: '.section-head [aria-pressed="true"]' }],
  ['test: screenshot thumbnails', 'sample', `#/test/${SCREENSHOT}`, { reached: '.thumb img' }],
  ['test: missing image and video', 'missingMedia', `#/test/${SCREENSHOT}`, { reached: '.media-missing' }],
  ['test: video, trace, comparison', 'sample', `#/test/${COMPARISON}`, { reached: '.video video' }],
  ['test: stdout and stderr expanded', 'sample', `#/test/${OUTPUT}`, { arrange: clickAll('details.output-block > summary'), reached: 'details.output-block[open]' }],
  ['test: skip reason', 'sample', `#/test/${SKIP_REASON}`, { reached: '.detail-skip' }],
  ['test: not run', 'sample', `#/test/${NOT_RUN}`, { reached: '.skip-explanation' }],
  ['test: raised after the test timeout', 'cascade', `#/test/${AFTER_TIMEOUT}`],
  // Comparison card
  ['comparison: diff', 'sample', `#/test/${COMPARISON}`, comparisonMode('Diff')],
  ['comparison: side by side', 'sample', `#/test/${COMPARISON}`, { ...comparisonMode('Side'), reached: '.cmp-side' }],
  ['comparison: slider', 'sample', `#/test/${COMPARISON}`, { ...comparisonMode('Slider'), reached: '.cmp-range' }],
  ['comparison: overlay', 'sample', `#/test/${COMPARISON}`, { ...comparisonMode('Overlay'), reached: '.cmp-opacity' }],
  ['comparison: slider at 360px', 'sample', `#/test/${COMPARISON}`, { ...comparisonMode('Slider'), width: 360, reached: '.cmp-range' }],
  // Lightbox and dialogs
  ['lightbox: screenshot', 'sample', `#/test/${SCREENSHOT}`, { arrange: click('.thumb'), reached: 'dialog.lightbox[open] img' }],
  ['lightbox: comparison', 'sample', `#/test/${COMPARISON}`, { arrange: clickText('button', 'Open in viewer'), reached: 'dialog.lightbox[open] .comparison' }],
  ['dialog: keyboard shortcuts', 'sample', '#/', { arrange: click('[aria-keyshortcuts="?"]'), reached: 'dialog.shortcuts-dialog[open]' }],
  ['dialog: copy fallback', 'sample', `#/test/${FAILING}`, { init: NO_CLIPBOARD, arrange: clickText('button', 'Copy rerun command'), reached: 'dialog.copy-dialog[open]' }],
  ['not found', 'sample', '#/no/such/page'],
  // Forced colours: bars kept, pressed and selected states in system colours.
  ['forced colours: overview', 'sample', '#/', { forcedColors: true, reached: '.outcome-bar-part' }],
  ['forced colours: tests with active chips', 'sample', '#/tests?tag=%40smoke', { forcedColors: true, reached: '.test-chip-active' }],
  ['forced colours: flaky test, attempt tabs', 'sample', `#/test/${FLAKY}`, { forcedColors: true, reached: '[role="tab"]' }],
  ['forced colours: comparison slider', 'sample', `#/test/${COMPARISON}`, { ...comparisonMode('Slider'), forcedColors: true, reached: '.cmp-range' }],
];

/** A file at each attachment path of `report` that a viewer shows: PNGs and a recorded video. */
async function writeMedia(report: LoupeReport, root: string, browser: Browser): Promise<void> {
  const recording = await browser.newContext({ recordVideo: { dir: path.join(root, 'recording'), size: { width: 320, height: 180 } } });
  const recorded = await recording.newPage();
  await recorded.setContent('<p style="font: 40px sans-serif">video</p>');
  await recorded.waitForTimeout(500);
  await recording.close();
  const video = await recorded.video()!.path();
  const attachments = report.tests.flatMap((test) => test.attempts.flatMap((attempt) => attempt.attachments));
  for (const { path: file, contentType, comparison } of attachments) {
    if (!file || !/^(image|video)\//.test(contentType)) continue;
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    if (contentType.startsWith('video/')) copyFileSync(video, target);
    // Playwright's diff takes the larger size: actual and diff wider than expected.
    else writeFileSync(target, comparison?.role === 'expected' ? solidPng(100, 100, [220, 0, 0]) : solidPng(160, 100, [0, 0, 220]));
  }
}

function variants(sample: LoupeReport): Record<Dataset, LoupeReport> {
  const missing = (name: string, contentType: string, kind: Attachment['kind']): Attachment => ({
    name,
    contentType,
    kind,
    path: `data/missing/${name}`,
    body: null,
    comparison: null,
  });
  return {
    sample,
    cascade: cascadeReport(),
    // Without stacks, no function is common to several failures: no failure points card.
    noPoints: {
      ...sample,
      tests: sample.tests.map((test) => ({
        ...test,
        attempts: test.attempts.map((attempt) => ({ ...attempt, errors: attempt.errors.map((error) => ({ ...error, stack: null })) })),
      })),
    },
    // 20 values of one dimension: tiles. As in renderer-build.test.ts.
    tiles: {
      ...sample,
      tests: sample.tests.map((test, index) => {
        const module = (test.outcome === 'failed' || test.outcome === 'flaky' ? 0 : 10) + (index % 10);
        return { ...test, dimensions: { ...test.dimensions, module: [`m${String(module).padStart(2, '0')}`] } };
      }),
      dimensions: [...sample.dimensions, { name: 'module', source: 'tag', key: 'module', values: null }],
    },
    // Past the 500-row cap, and more chips per row than the 4 shown collapsed.
    many: {
      ...sample,
      tests: Array.from({ length: 600 }, (_, index) => {
        const test = sample.tests[index % sample.tests.length]!;
        return { ...test, id: index.toString(16).padStart(16, '0'), title: `${test.title} #${index}`, tags: [...test.tags, '@nightly', '@regression', '@slow', '@eu', '@mobile'] };
      }),
    },
    missingMedia: {
      ...sample,
      tests: sample.tests.map((test) =>
        test.id !== SCREENSHOT
          ? test
          : {
              ...test,
              attempts: test.attempts.map((attempt, index) =>
                index > 0 ? attempt : { ...attempt, attachments: [...attempt.attachments, missing('gone.png', 'image/png', 'screenshot'), missing('gone.webm', 'video/webm', 'video')] },
              ),
            },
      ),
    },
  };
}

describe('accessibility harness', { timeout: 30_000 }, () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser?.close();
  });

  const BROKEN = `<!doctype html><html lang="en"><head><title>Broken</title></head><body><main>
    <h1>Broken</h1><input type="text"><p style="color: #c8c8c8; background: #ffffff">Low contrast</p>
  </main></body></html>`;

  it('fails on a missing label and on low contrast', async () => {
    const page = await browser.newPage();
    await page.setContent(BROKEN);
    const { failures } = await audit(page);
    expect(failures.map(({ rule, wcag }) => [rule, wcag]).sort()).toEqual([
      ['color-contrast', true],
      ['label', true],
    ]);
    await page.close();
  });

  it('moves an allowlisted finding out of the failures, by rule and selector only', async () => {
    const page = await browser.newPage();
    await page.setContent(BROKEN);
    const entry: AllowEntry = { rule: 'label', selector: 'input[type="text"]', reason: 'test' };
    const otherRule: AllowEntry = { rule: 'color-contrast', selector: 'input', reason: 'test' };
    const { failures, allowed } = await audit(page, [entry, otherRule]);
    expect(failures.map(({ rule }) => rule)).toEqual(['color-contrast']);
    expect(allowed.map(({ entry: used, finding }) => [used, finding.rule])).toEqual([[entry, 'label']]);
    await page.close();
  });

  it('is never part of the report bundle', () => {
    expect(readFileSync(RENDERER, 'utf8')).not.toMatch(/axe-core|axe\.run|Deque/);
  });
});

describe('accessibility matrix (axe-core, file://)', { timeout: 60_000 }, () => {
  let browser: Browser;
  let workDir: string;
  const urls = {} as Record<Dataset, string>;
  const used = new Set<AllowEntry>();
  const listed = new Map<string, Set<string>>();

  /** Records a finding for the summary printed after the run: one line per rule and impact, with its states. */
  function list(kind: string, finding: Finding, state: string): void {
    const key = `${kind} ${finding.rule} (${finding.impact ?? 'no impact'}): ${finding.help}`;
    listed.set(key, (listed.get(key) ?? new Set()).add(state));
  }

  beforeAll(async () => {
    assertBuilt();
    workDir = mkdtempSync(path.join(tmpdir(), 'loupe-a11y-'));
    browser = await chromium.launch();
    const sample = JSON.parse(readFileSync(SAMPLE, 'utf8')) as LoupeReport;
    await writeMedia(sample, workDir, browser);
    const template = readFileSync(RENDERER, 'utf8');
    for (const [name, report] of Object.entries(variants(sample)) as Array<[Dataset, LoupeReport]>) {
      const file = path.join(workDir, `${name}.html`);
      writeFileSync(file, injectSettings(injectData(template, report), { ...DEFAULT_RENDERER_SETTINGS, title: 'Storefront' }));
      urls[name] = pathToFileURL(file).href;
    }
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    if (workDir) rmSync(workDir, { recursive: true, force: true });
    if (listed.size > 0) {
      const lines = [...listed].map(([key, states]) => `- ${key}\n    ${states.size} states, e.g. ${[...states].slice(0, 3).join('; ')}`);
      console.info(`Accessibility findings listed, not failing:\n${lines.join('\n')}`);
    }
  });

  describe.each(['light', 'dark'] as const)('%s theme', (theme) => {
    it.each(MATRIX)('%s', async (name, dataset, hash, options = {}) => {
      const context = await browser.newContext({
        colorScheme: theme,
        forcedColors: options.forcedColors ? 'active' : 'none',
        viewport: { width: options.width ?? 1300, height: options.height ?? 900 },
      });
      if (options.init) await context.addInitScript({ content: options.init });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error' && !isMissingAttachmentFile(message, page)) errors.push(message.text());
      });
      await page.goto(`${urls[dataset]}${hash}`);
      await page.locator('.main h1').first().waitFor();
      await options.arrange?.(page);
      if (options.reached) await page.locator(options.reached).first().waitFor({ state: 'attached' });

      const result = await audit(page, A11Y_ALLOWLIST);
      const state = `${theme}: ${name}`;
      for (const { entry } of result.allowed) used.add(entry);
      for (const finding of result.listed) list(finding.wcag ? 'WCAG' : 'best practice', finding, state);
      for (const finding of result.incomplete) list('needs review', finding, state);
      expect(result.failures.map(describeFinding)).toEqual([]);
      expect(errors).toEqual([]);
      await context.close();
    });
  });

  describe('landmarks, skip link and code snippets', () => {
    async function open(url: string, width = 1300): Promise<Page> {
      const page = await browser.newPage({ viewport: { width, height: 700 } });
      await page.goto(url);
      await page.locator('.main h1').first().waitFor();
      return page;
    }

    /** Presses Tab until `selector` has focus, at most `limit` times; false if it never does. */
    async function tabTo(page: Page, selector: string, limit = 80): Promise<boolean> {
      for (let index = 0; index < limit; index++) {
        await page.keyboard.press('Tab');
        if (await page.locator(selector).first().evaluate((element) => element === element.ownerDocument.activeElement)) return true;
      }
      return false;
    }

    const outlineOf = (page: Page) => page.evaluate<string>('getComputedStyle(document.activeElement).outlineStyle');

    it('has one banner, one main and the sidebar navigation', async () => {
      const page = await open(`${urls.sample}#/`);
      expect(await page.getByRole('banner').count()).toBe(1);
      // The header and the partial run note.
      expect(await page.getByRole('banner').locator('.header, .banner-partial').count()).toBe(2);
      expect(await page.getByRole('main').count()).toBe(1);
      expect(await page.getByRole('navigation', { name: 'Report' }).count()).toBe(1);
      await page.close();
    });

    it('keeps one main landmark on the load error page', async () => {
      const file = path.join(workDir, 'unreadable.html');
      writeFileSync(file, injectSettings(injectData(readFileSync(RENDERER, 'utf8'), { schemaVersion: 99 }), DEFAULT_RENDERER_SETTINGS));
      const page = await browser.newPage();
      await page.goto(pathToFileURL(file).href);
      await page.getByRole('alert').waitFor();
      expect(await page.getByRole('main').count()).toBe(1);
      expect(await page.getByRole('main').getByRole('alert').count()).toBe(1);
      await page.close();
    });

    it.each([1300, 360])('skips to the content from the first Tab, without changing the hash, at %ipx', async (width) => {
      const page = await open(`${urls.sample}#/health`, width);
      const skip = page.getByRole('button', { name: 'Skip to content' });
      expect(await skip.boundingBox()).toMatchObject({ width: 1, height: 1 });
      await page.keyboard.press('Tab');
      expect(await skip.evaluate((element) => element === element.ownerDocument.activeElement)).toBe(true);
      // Shown while focused, inside the viewport, with the focus ring.
      const box = (await skip.boundingBox())!;
      expect(box.width).toBeGreaterThan(24);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(await outlineOf(page)).toBe('solid');
      await page.keyboard.press('Enter');
      expect(await page.locator('.main').evaluate((element) => element === element.ownerDocument.activeElement)).toBe(true);
      expect(new URL(page.url()).hash).toBe('#/health');
      // From there, the keyboard scrolls the content.
      await page.keyboard.press('PageDown');
      await expect.poll(() => page.locator('.main').evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      await page.close();
    });

    it('reaches a video with Tab and shows the focus ring', async () => {
      const page = await open(`${urls.sample}#/test/${COMPARISON}`);
      expect(await tabTo(page, '.video video')).toBe(true);
      expect(await outlineOf(page)).toBe('solid');
      await page.close();
    });

    it('reaches a code snippet with Tab, shows the focus ring and scrolls it with the arrow keys', async () => {
      const page = await open(`${urls.sample}#/test/${FAILING}`, 360);
      const snippet = page.locator('.code-snippet').first();
      expect(await snippet.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
      expect(await tabTo(page, '.code-snippet')).toBe(true);
      expect(await outlineOf(page)).toBe('solid');
      for (let index = 0; index < 5; index++) await page.keyboard.press('ArrowRight');
      await expect.poll(() => snippet.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      await page.close();
    });
  });

  it('uses every allowlist entry', () => {
    expect(A11Y_ALLOWLIST.filter((entry) => !used.has(entry)).map(({ rule, selector }) => `${rule} on ${selector}`)).toEqual([]);
  });
});
