import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RENDERER_SETTINGS, injectData, injectSettings } from '../src/core/inject.js';
import type { Attachment, LoupeReport, TestCase } from '../src/schema/v1.js';
import { ROOT, assertBuilt } from './helpers/fixtures.js';

/**
 * The link opening a trace in the bundled trace viewer, in the built renderer
 * served by a local HTTP server: the viewer needs http(s) in a secure context.
 * The `traceViewer` setting says the core copied the viewer; the renderer never
 * asks the server whether it is there.
 */

const RENDERER = path.join(ROOT, 'dist/renderer/index.html');
const SAMPLE = path.join(ROOT, 'src/renderer/dev/sample.json');
const DATA = 'data/viewer/0';

const trace = (fileName: string): Attachment => ({ name: 'trace', contentType: 'application/zip', kind: 'trace', path: `${DATA}/${fileName}`, body: null, comparison: null });

/**
 * What the server does besides serving the folder: `sandbox/` answers with a
 * CSP `sandbox` header, as Jenkins can; `fallback/` answers every missing path
 * with a report page, as a single-page application server does.
 */
function serve(root: string, requests: string[]): Server {
  return createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://server').pathname);
    requests.push(pathname);
    const file = path.join(root, pathname);
    const headers: Record<string, string> = pathname.startsWith('/sandbox/') ? { 'content-security-policy': 'sandbox allow-scripts allow-popups' } : {};
    if (existsSync(file) && statSync(file).isFile()) {
      res.writeHead(200, { 'content-type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream', ...headers });
      createReadStream(file).pipe(res);
    } else if (pathname.startsWith('/fallback/')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      createReadStream(path.join(root, 'fallback/index.html')).pipe(res);
    } else {
      res.writeHead(404).end();
    }
  });
}

describe('opening a trace in the bundled trace viewer (http)', { timeout: 30_000 }, () => {
  let browser: Browser;
  let workDir: string;
  let server: Server;
  let origin: string;
  let target: TestCase;
  const requests: string[] = [];

  /** Writes a report page, its settings holding `traceViewer`. */
  function writeReport(file: string, report: LoupeReport, traceViewer: string | null): void {
    const target = path.join(workDir, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, injectSettings(injectData(readFileSync(RENDERER, 'utf8'), report), { ...DEFAULT_RENDERER_SETTINGS, traceViewer }));
  }

  async function open(url: string, { width = 1200 }: { width?: number } = {}): Promise<{ page: Page; errors: string[] }> {
    const context = await browser.newContext({ viewport: { width, height: 800 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    await page.locator('.trace-card').first().waitFor();
    return { page, errors };
  }

  const openLinks = (page: Page) => page.locator('.trace-open');

  beforeAll(async () => {
    assertBuilt();
    workDir = mkdtempSync(path.join(tmpdir(), 'loupe-trace-viewer-'));
    const report = JSON.parse(readFileSync(SAMPLE, 'utf8')) as LoupeReport;
    target = report.tests.find((test) => test.title === 'attaches a screenshot' && test.project === 'chromium-a')!;
    const [first] = target.attempts;
    target.attempts = [
      { ...first!, index: 0, attachments: [trace('trace.zip'), trace('my trace.zip')] },
      { ...first!, index: 1, attachments: [trace('retry.zip')] },
    ];
    writeReport('with-viewer.html', report, 'trace-viewer');
    writeReport('without-viewer.html', report, null);
    writeReport('sandbox/index.html', report, 'trace-viewer');
    writeReport('fallback/index.html', report, null);
    mkdirSync(path.join(workDir, 'trace-viewer'));
    writeFileSync(path.join(workDir, 'trace-viewer/index.html'), '<!doctype html><title>Viewer stand-in</title>');
    server = serve(workDir, requests);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    // report.test: any host that is not localhost, so the page is not a secure context over http.
    browser = await chromium.launch({ args: ['--host-resolver-rules=MAP report.test 127.0.0.1'] });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    server?.close();
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it('opens the trace from an absolute URL, in a new tab, as the first action of the card', async () => {
    const { page, errors } = await open(`${origin}/with-viewer.html#/test/${target.id}?attempt=0`);
    const links = openLinks(page);
    await expect.poll(() => links.count()).toBe(2);
    const expected = (fileName: string) => `trace-viewer/index.html?trace=${encodeURIComponent(`${origin}/${DATA}/${fileName}`)}`;
    expect(await links.evaluateAll((all) => all.map((link) => link.getAttribute('href')))).toEqual([expected('trace.zip'), expected('my%20trace.zip')]);
    expect(await links.first().getAttribute('target')).toBe('_blank');
    expect(await links.first().getAttribute('rel')).toBe('noopener');
    expect(await links.first().textContent()).toBe('Open in Trace Viewer');
    const actions = page.locator('.trace-actions').first().locator(':scope > .button');
    expect(await actions.evaluateAll((all) => all.map((element) => element.textContent))).toEqual(['Open in Trace Viewer', 'Copy trace command', 'Download trace']);

    const [popup] = await Promise.all([page.waitForEvent('popup'), links.first().click()]);
    await popup.waitForLoadState();
    expect(popup.url()).toBe(`${origin}/${expected('trace.zip')}`);
    expect(await popup.title()).toBe('Viewer stand-in');
    expect(errors).toEqual([]);
    await page.context().close();
  });

  it('names the attempt and the new tab, and opens from the keyboard', async () => {
    const { page } = await open(`${origin}/with-viewer.html#/test/${target.id}?attempt=1`);
    const link = page.getByRole('link', { name: 'Open in Trace Viewer: trace, Retry 1, in a new tab' });
    await link.waitFor();
    await link.focus();
    const [popup] = await Promise.all([page.waitForEvent('popup'), page.keyboard.press('Enter')]);
    await popup.waitForLoadState();
    expect(popup.url()).toBe(`${origin}/trace-viewer/index.html?trace=${encodeURIComponent(`${origin}/${DATA}/retry.zip`)}`);

    await page.goto(`${origin}/with-viewer.html#/test/${target.id}?attempt=0`);
    await expect.poll(() => page.getByRole('link', { name: 'Open in Trace Viewer: trace, Attempt 1, in a new tab' }).count()).toBe(2);
    await page.context().close();
  });

  it('counts http://localhost as secure', async () => {
    const { page } = await open(`${origin.replace('127.0.0.1', 'localhost')}/with-viewer.html#/test/${target.id}?attempt=0`);
    await expect.poll(() => openLinks(page).count()).toBe(2);
    await page.context().close();
  });

  it('keeps the card as it is without the setting, over file://, on an insecure origin and under a CSP sandbox', async () => {
    const port = new URL(origin).port;
    for (const url of [
      `${origin}/without-viewer.html`,
      pathToFileURL(path.join(workDir, 'with-viewer.html')).href,
      `http://report.test:${port}/with-viewer.html`,
      `${origin}/sandbox/index.html`,
    ]) {
      const { page } = await open(`${url}#/test/${target.id}?attempt=0`);
      await page.getByRole('button', { name: 'Copy trace command' }).first().waitFor();
      expect(await openLinks(page).count(), url).toBe(0);
      expect(await page.locator('.trace-actions').first().locator(':scope > .button').count(), url).toBe(2);
      await page.context().close();
    }
  });

  it('never asks the server for the viewer, so a server answering every path cannot fool it', async () => {
    requests.length = 0;
    const { page } = await open(`${origin}/fallback/index.html#/test/${target.id}?attempt=0`);
    await page.getByRole('button', { name: 'Copy trace command' }).first().waitFor();
    expect(await openLinks(page).count()).toBe(0);
    await page.goto(`${origin}/with-viewer.html#/test/${target.id}?attempt=0`);
    await expect.poll(() => openLinks(page).count()).toBe(2);
    expect(requests.filter((request) => request.includes('trace-viewer'))).toEqual([]);
    await page.context().close();
  });

  it('fits a 320px wide screen without horizontal scrolling', async () => {
    const { page } = await open(`${origin}/with-viewer.html#/test/${target.id}?attempt=0`, { width: 320 });
    await expect.poll(() => openLinks(page).count()).toBe(2);
    expect(await page.evaluate<boolean>('document.documentElement.scrollWidth <= document.documentElement.clientWidth')).toBe(true);
    const box = await openLinks(page).first().boundingBox();
    expect(box && box.x + box.width).toBeLessThanOrEqual(320);
    await page.context().close();
  });
});
