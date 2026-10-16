import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DATA_PLACEHOLDER,
  DEFAULT_RENDERER_SETTINGS,
  SETTINGS_PLACEHOLDER,
  injectData,
  injectSettings,
  type RendererSettings,
} from '../src/core/inject.js';
import type { LoupeReport } from '../src/schema/v1.js';
import { ROOT, assertBuilt } from './helpers/fixtures.js';

const RENDERER_DIR = path.join(ROOT, 'dist/renderer');
const SAMPLE = path.join(ROOT, 'src/renderer/dev/sample.json');

function occurrences(text: string, search: string): number {
  return text.split(search).length - 1;
}

function scriptText(html: string, id: string): string {
  const open = `<script id="${id}" type="application/json">`;
  const start = html.indexOf(open) + open.length;
  return html.slice(start, html.indexOf('</script>', start));
}

describe('built renderer', () => {
  let template: string;

  beforeAll(() => {
    assertBuilt();
    template = readFileSync(path.join(RENDERER_DIR, 'index.html'), 'utf8');
  });

  it('is a single HTML file', () => {
    expect(readdirSync(RENDERER_DIR, { recursive: true })).toEqual(['index.html']);
  });

  it('inlines its JS and CSS and loads nothing else', () => {
    expect(template).toMatch(/<script type="module"[^>]*>[^<]/);
    expect(template).toContain('<style>');
    expect(template).not.toMatch(/<script[^>]*\ssrc=/);
    expect(template).not.toMatch(/<link[^>]*stylesheet/);
    expect(template).not.toMatch(/\s(?:src|href)="(?:\.\/|\/|https?:)/);
  });

  it('keeps each injection placeholder exactly once', () => {
    expect(occurrences(template, DATA_PLACEHOLDER)).toBe(1);
    expect(occurrences(template, SETTINGS_PLACEHOLDER)).toBe(1);
  });

  it('accepts the report data and the settings through the injection functions', () => {
    const report = JSON.parse(readFileSync(SAMPLE, 'utf8')) as LoupeReport;
    const settings: RendererSettings = { ...DEFAULT_RENDERER_SETTINGS, title: 'Nightly </script>' };
    const html = injectSettings(injectData(template, report), settings);
    expect(html).not.toContain('__LOUPE_DATA__');
    expect(html).not.toContain('__LOUPE_SETTINGS__');
    expect(JSON.parse(scriptText(html, 'loupe-data'))).toEqual(report);
    expect(JSON.parse(scriptText(html, 'loupe-settings'))).toEqual(settings);
  });
});

/** Opens the built renderer from file://, the way users open a report. */
describe('built renderer in a browser (file://)', { timeout: 30_000 }, () => {
  let browser: Browser;
  let workDir: string;
  let report: LoupeReport;

  function writeReport(name: string, data: unknown, settings: RendererSettings = DEFAULT_RENDERER_SETTINGS): string {
    const file = path.join(workDir, `${name}.html`);
    const template = readFileSync(path.join(RENDERER_DIR, 'index.html'), 'utf8');
    writeFileSync(file, injectSettings(injectData(template, data), settings));
    return pathToFileURL(file).href;
  }

  async function open(url: string, options: { colorScheme?: 'light' | 'dark' } = {}): Promise<{ page: Page; errors: string[] }> {
    const page = await browser.newPage(options);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(url);
    return { page, errors };
  }

  beforeAll(async () => {
    assertBuilt();
    workDir = mkdtempSync(path.join(tmpdir(), 'loupe-renderer-'));
    report = JSON.parse(readFileSync(SAMPLE, 'utf8')) as LoupeReport;
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it('renders the header, the partial run banner and the sidebar', async () => {
    const { page, errors } = await open(writeReport('sample', report, { ...DEFAULT_RENDERER_SETTINGS, title: 'Sample run' }));
    await expect.poll(() => page.title()).toBe('Sample run');
    expect(await page.locator('.header .title').textContent()).toBe('Sample run');
    expect(await page.getByRole('note').textContent()).toMatch(/Partial run.*grep filter/);
    expect(await page.getByRole('link', { name: /Run errors/ }).textContent()).toContain(String(report.run.errors.length));
    expect(await page.getByRole('treeitem', { level: 1 }).count()).toBe(report.projects.length);
    expect(errors).toEqual([]);
    await page.close();
  });

  it('navigates through hash routes, from links and from the URL', async () => {
    const failed = report.tests.find((test) => test.outcome === 'failed' && test.repeatEachIndex === 0);
    if (!failed) throw new Error('the sample has no failed test');
    const { page, errors } = await open(`${writeReport('routes', report)}#/test/${failed.id}`);
    await page.getByRole('heading', { level: 1, name: failed.title }).waitFor();
    // Opening a test from the URL reveals and selects it in the tree.
    expect(await page.locator('[role="treeitem"][aria-selected="true"]').textContent()).toContain(failed.title);

    await page.getByRole('link', { name: /Run errors/ }).click();
    await page.getByRole('heading', { level: 1, name: 'Run errors' }).waitFor();
    expect(page.url()).toMatch(/#\/run-errors$/);

    await page.goBack();
    await page.getByRole('heading', { level: 1, name: failed.title }).waitFor();
    expect(errors).toEqual([]);
    await page.close();
  });

  it('supports keyboard navigation in the tree', async () => {
    const { page } = await open(writeReport('keyboard', report));
    const focused = page.locator('[role="treeitem"]:focus');
    const level = async () => Number(await focused.getAttribute('aria-level'));
    const firstProject = page.getByRole('treeitem', { level: 1 }).first();
    await firstProject.focus();
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => firstProject.getAttribute('aria-expanded')).toBe('false');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => firstProject.getAttribute('aria-expanded')).toBe('true');
    await page.keyboard.press('ArrowDown');
    await expect.poll(level).toBe(2);
    // Open groups and step into them until a test is focused.
    while ((await focused.getAttribute('aria-expanded')) !== null) {
      const current = await level();
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => focused.getAttribute('aria-expanded')).toBe('true');
      await page.keyboard.press('ArrowRight');
      await expect.poll(level).toBe(current + 1);
    }
    const title = (await focused.locator('.row-label').textContent()) ?? '';
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { level: 1, name: title }).waitFor();
    expect(page.url()).toMatch(/#\/test\/[0-9a-f]{16}$/);
    // ArrowLeft on a test goes back to its group.
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => focused.getAttribute('aria-expanded')).toBe('true');
    await page.close();
  });

  it('uses the configured theme by default and remembers the viewer choice', async () => {
    const url = writeReport('theme', report, { ...DEFAULT_RENDERER_SETTINGS, theme: 'dark' });
    const { page } = await open(url, { colorScheme: 'light' });
    // No data-theme attribute means "follow the system".
    const theme = async () => (await page.locator('html').getAttribute('data-theme')) ?? 'system';
    await expect.poll(theme).toBe('dark');
    await page.getByRole('button', { name: 'Light theme' }).click();
    await expect.poll(theme).toBe('light');
    await page.reload();
    await expect.poll(theme).toBe('light');
    await page.close();
  });

  it('works without localStorage', async () => {
    const context = await browser.newContext();
    await context.addInitScript({
      content: "Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage disabled'); } });",
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(writeReport('no-storage', report));
    await page.getByRole('button', { name: 'Dark theme' }).click();
    await expect.poll(() => page.locator('html').getAttribute('data-theme')).toBe('dark');
    expect(errors).toEqual([]);
    await context.close();
  });

  it('shows a run without tests, with its run errors', async () => {
    const empty = { ...report, tests: [], run: { ...report.run, scope: 'full', scopeReasons: [] } };
    const { page, errors } = await open(writeReport('empty', empty));
    await page.getByText('No tests in this run.').waitFor();
    expect(await page.getByRole('note').count()).toBe(0);
    await page.getByRole('link', { name: /Run errors/ }).click();
    await page.locator('.run-error').first().waitFor();
    expect(await page.locator('.run-error').count()).toBe(report.run.errors.length);
    expect(errors).toEqual([]);
    await page.close();
  });

  it('explains when the data cannot be read', async () => {
    const { page } = await open(writeReport('bad', { schemaVersion: 99 }));
    expect(await page.getByRole('alert').textContent()).toMatch(/Unsupported report schema version 99/);
    await page.close();
  });
});
