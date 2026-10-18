import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RENDERER_SETTINGS, injectData, injectSettings } from '../src/core/inject.js';
import type { Attachment, LoupeReport, TestCase } from '../src/schema/v1.js';
import { ROOT, assertBuilt, isMissingAttachmentFile } from './helpers/fixtures.js';
import { solidPng } from './helpers/png.js';

/**
 * The media viewers of the test detail, in the built renderer opened from
 * file://. The report is synthetic: the renderer sample with one test given
 * known attachments, written with their files (generated PNGs, a video
 * recorded by Playwright) to a temporary folder. The sample's own files are
 * gitignored, so they cannot be relied on here.
 */

const RENDERER = path.join(ROOT, 'dist/renderer/index.html');
const SAMPLE = path.join(ROOT, 'src/renderer/dev/sample.json');
const DATA = 'data/media/0';

function attachment(name: string, contentType: string, kind: Attachment['kind'], fileName: string | null, fields: Partial<Attachment> = {}): Attachment {
  return { name, contentType, kind, path: fileName === null ? null : `${DATA}/${fileName}`, body: null, comparison: null, ...fields };
}

const SCREENSHOTS = [
  attachment('wide', 'image/png', 'screenshot', 'wide.png'),
  attachment('tall', 'image/png', 'screenshot', 'tall.png'),
  attachment('gone', 'image/png', 'screenshot', 'gone.png'),
];
const VIDEOS = [attachment('video', 'video/webm', 'video', 'video.webm'), attachment('lost video', 'video/webm', 'video', 'lost.webm')];

describe('media viewers in a browser (file://)', { timeout: 30_000 }, () => {
  let browser: Browser;
  let workDir: string;
  let url: string;
  let target: TestCase;
  let other: TestCase;

  async function open(hash: string): Promise<{ page: Page; errors: string[] }> {
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      // Missing attachment files are part of the test: their load errors are expected.
      if (message.type() === 'error' && !isMissingAttachmentFile(message, page)) errors.push(message.text());
    });
    await page.goto(`${url}${hash}`);
    return { page, errors };
  }

  const hashOf = (page: Page): string => decodeURIComponent(new URL(page.url()).hash);
  const isActive = (page: Page, selector: string): Promise<boolean> =>
    page.locator(selector).evaluate((element) => element === element.ownerDocument.activeElement);

  beforeAll(async () => {
    assertBuilt();
    workDir = mkdtempSync(path.join(tmpdir(), 'loupe-media-'));
    const data = path.join(workDir, DATA);
    mkdirSync(data, { recursive: true });
    writeFileSync(path.join(data, 'wide.png'), solidPng(2400, 120, [200, 40, 40]));
    writeFileSync(path.join(data, 'tall.png'), solidPng(80, 240, [40, 40, 200]));

    browser = await chromium.launch();
    const recording = await browser.newContext({ recordVideo: { dir: path.join(workDir, 'recording'), size: { width: 320, height: 180 } } });
    const recorded = await recording.newPage();
    await recorded.setContent('<h1 style="font: 40px sans-serif">video</h1>');
    await recorded.waitForTimeout(500);
    await recording.close();
    copyFileSync(await recorded.video()!.path(), path.join(data, 'video.webm'));

    const report = JSON.parse(readFileSync(SAMPLE, 'utf8')) as LoupeReport;
    const find = (title: string): TestCase => report.tests.find((test) => test.title === title && test.project === 'chromium-a')!;
    target = find('attaches a screenshot');
    other = find('shows the heading');
    const [first] = target.attempts;
    target.attempts = [{ ...first!, attachments: [...SCREENSHOTS, ...VIDEOS] }];
    const file = path.join(workDir, 'index.html');
    writeFileSync(file, injectSettings(injectData(readFileSync(RENDERER, 'utf8'), report), DEFAULT_RENDERER_SETTINGS));
    url = pathToFileURL(file).href;
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it('shows screenshots as lazy thumbnails, with a placeholder for a missing file', async () => {
    const { page, errors } = await open(`#/test/${target.id}`);
    const thumbs = page.locator('.thumb');
    await expect.poll(() => thumbs.count()).toBe(3);
    const images = page.locator('.thumb img');
    expect(await images.evaluateAll((all) => all.map((image) => [image.getAttribute('alt'), image.getAttribute('loading'), image.getAttribute('decoding')]))).toEqual([
      ['wide', 'lazy', 'async'],
      ['tall', 'lazy', 'async'],
    ]);
    await expect.poll(() => images.evaluateAll((all) => all.map((image) => (image as unknown as { naturalWidth: number }).naturalWidth))).toEqual([2400, 80]);
    // The missing file: its name and path, no image (so no broken icon).
    const missing = thumbs.nth(2);
    expect(await missing.locator('img').count()).toBe(0);
    expect(await missing.locator('.media-missing').textContent()).toBe(`goneFile not found${DATA}/gone.png`);
    expect(await page.getByRole('button', { name: 'wide' }).count()).toBe(1);
    expect(errors).toEqual([]);
    await page.close();
  });

  it('ignores only missing attachment files under data/, never a missing bundle or report file', async () => {
    const file = path.join(workDir, 'missing-files.html');
    writeFileSync(file, '<img src="data/media/0/nowhere.png"><script src="bundle.js"></script><img src="report.png">');
    const page = await browser.newPage();
    const failed: string[] = [];
    const counted: string[] = [];
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const name = message.location().url.slice(message.location().url.lastIndexOf('/') + 1);
      failed.push(name);
      if (!isMissingAttachmentFile(message, page)) counted.push(name);
    });
    await page.goto(pathToFileURL(file).href);
    await expect.poll(() => failed.length).toBe(3);
    expect(counted.sort()).toEqual(['bundle.js', 'report.png']);
    await page.close();
  });

  it('opens the lightbox by click and keyboard, and moves with buttons and arrows, without wrapping', async () => {
    const { page, errors } = await open(`#/test/${target.id}`);
    await page.getByRole('button', { name: 'wide' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    const position = dialog.locator('.lightbox-position');
    expect(await dialog.getByRole('heading').textContent()).toBe('wide');
    expect(await position.textContent()).toBe('1 of 3');
    const original = dialog.getByRole('link', { name: 'Open original' });
    expect(await original.getAttribute('href')).toBe(`${DATA}/wide.png`);
    expect(await original.getAttribute('target')).toBe('_blank');
    expect(await dialog.getByRole('button', { name: '← Previous' }).isDisabled()).toBe(true);
    // At the start, ← does nothing.
    await page.keyboard.press('ArrowLeft');
    expect(await position.textContent()).toBe('1 of 3');

    await dialog.getByRole('button', { name: 'Next →' }).click();
    expect(await position.textContent()).toBe('2 of 3');
    expect(await dialog.getByRole('img', { name: 'tall' }).count()).toBe(1);
    await page.keyboard.press('ArrowRight');
    expect(await position.textContent()).toBe('3 of 3');
    await expect.poll(() => dialog.locator('.media-missing').count()).toBe(1);
    expect(await dialog.getByRole('button', { name: 'Next →' }).isDisabled()).toBe(true);
    await page.keyboard.press('ArrowRight');
    expect(await position.textContent()).toBe('3 of 3');
    await page.keyboard.press('ArrowLeft');
    expect(await position.textContent()).toBe('2 of 3');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });

    // From the keyboard: Enter and Space on a thumbnail.
    await page.getByRole('button', { name: 'tall' }).focus();
    await page.keyboard.press('Enter');
    expect(await position.textContent()).toBe('2 of 3');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await page.keyboard.press('Space');
    expect(await position.textContent()).toBe('2 of 3');
    expect(errors).toEqual([]);
    await page.close();
  });

  it('closes with Escape, the close button or the backdrop, and returns focus to the thumbnail', async () => {
    const { page } = await open(`#/test/${target.id}`);
    const dialog = page.getByRole('dialog');
    const thumb = '.thumb >> nth=1';
    const close = [
      () => page.keyboard.press('Escape'),
      () => dialog.getByRole('button', { name: 'Close' }).click(),
      () => page.mouse.click(4, 4),
    ];
    for (const action of close) {
      await page.locator(thumb).click();
      await dialog.waitFor();
      await action();
      await dialog.waitFor({ state: 'hidden' });
      expect(await isActive(page, thumb)).toBe(true);
    }
    expect(hashOf(page)).toBe(`#/test/${target.id}`);
    await page.close();
  });

  it('toggles between fitted and actual size by clicking the image or the button', async () => {
    const { page } = await open(`#/test/${target.id}`);
    await page.getByRole('button', { name: 'wide' }).click();
    const dialog = page.getByRole('dialog');
    const toggle = dialog.getByRole('button', { name: 'Actual size' });
    expect(await toggle.getAttribute('aria-pressed')).toBe('false');
    const image = dialog.getByRole('img', { name: 'wide' });
    const width = (): Promise<number> => image.evaluate((element) => element.getBoundingClientRect().width);
    // Fitted: narrower than the viewport.
    expect(await width()).toBeLessThan(1200);
    await image.click();
    expect(await toggle.getAttribute('aria-pressed')).toBe('true');
    expect(await width()).toBe(2400);
    expect(await dialog.locator('.lightbox-stage').evaluate((stage) => stage.scrollWidth > stage.clientWidth)).toBe(true);
    await toggle.click();
    expect(await toggle.getAttribute('aria-pressed')).toBe('false');
    expect(await width()).toBeLessThan(1200);
    // Another image starts fitted again.
    await toggle.click();
    await page.keyboard.press('ArrowRight');
    expect(await toggle.getAttribute('aria-pressed')).toBe('false');
    await page.close();
  });

  it('keeps page shortcuts inactive while open, and closes on a route change', async () => {
    const { page, errors } = await open(`#/test/${other.id}`);
    await page.evaluate(`location.hash = '#/test/${target.id}'`);
    await page.getByRole('button', { name: 'wide' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    for (const key of ['j', 'k', ']', '?', '/']) await page.keyboard.press(key);
    expect(hashOf(page)).toBe(`#/test/${target.id}`);
    expect(await page.getByRole('dialog').count()).toBe(1);
    expect(await dialog.getByRole('heading').textContent()).toBe('wide');

    await page.goBack();
    await expect.poll(() => hashOf(page)).toBe(`#/test/${other.id}`);
    expect(await page.locator('dialog[open]').count()).toBe(0);
    // Shortcuts work again, and coming back does not reopen the lightbox.
    await page.goForward();
    await page.locator('.thumb').first().waitFor();
    expect(await page.locator('dialog[open]').count()).toBe(0);
    await page.keyboard.press('?');
    const shortcuts = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await shortcuts.waitFor();
    expect(await shortcuts.getByRole('row', { name: /Previous \/ next screenshot/ }).textContent()).toBe('← / →Previous / next screenshotScreenshot viewer');
    expect(errors).toEqual([]);
    await page.close();
  });

  it('plays videos inline, and shows the path of a video that cannot be played', async () => {
    const { page, errors } = await open(`#/test/${target.id}`);
    const videos = page.locator('.video');
    await expect.poll(() => videos.count()).toBe(2);
    const player = videos.first().locator('video');
    expect(await player.evaluate((video) => [(video as unknown as { controls: boolean }).controls, video.getAttribute('preload')])).toEqual([true, 'metadata']);
    expect(await player.locator('source').evaluate((source) => [source.getAttribute('src'), source.getAttribute('type')])).toEqual([`${DATA}/video.webm`, 'video/webm']);
    // It loads from file://.
    await expect.poll(() => player.evaluate((video) => (video as unknown as { readyState: number }).readyState)).toBeGreaterThanOrEqual(1);
    expect(await videos.first().getByRole('link', { name: 'Open original' }).getAttribute('href')).toBe(`${DATA}/video.webm`);

    // No empty player for a missing file.
    await expect.poll(() => videos.nth(1).locator('video').count()).toBe(0);
    expect(await videos.nth(1).locator('.media-missing').textContent()).toBe(`lost videoCannot play this video${DATA}/lost.webm`);
    expect(errors).toEqual([]);
    await page.close();
  });
});
