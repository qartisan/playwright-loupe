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
    // Fonts are embedded: every CSS url() is a data URI, nothing comes from the network.
    expect(template.match(/url\(\s*["']?data:font\/woff2;base64,/g)).toHaveLength(2);
    expect(template).not.toMatch(/url\(\s*["']?(?!data:)[^)\s]/);
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

  async function open(
    url: string,
    options: { colorScheme?: 'light' | 'dark'; viewport?: { width: number; height: number } } = {},
  ): Promise<{ page: Page; errors: string[] }> {
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
    const nav = page.locator('.nav-fixed .nav-link');
    expect(await nav.locator('span:not(.visually-hidden):not(.badge):not(.nav-marker)').allTextContents()).toEqual(['Overview', 'Errors', 'Suite health']);
    expect(await page.getByRole('link', { name: /Run errors/ }).count()).toBe(0);
    // The Errors entry carries a warning marker and the run error count.
    const errorsLink = page.getByRole('link', { name: /^Errors/ });
    expect(await errorsLink.locator('.nav-marker .badge').textContent()).toBe(String(report.run.errors.length));
    expect(await errorsLink.textContent()).toContain(`${report.run.errors.length} run error`);
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

    for (const [name, path, heading] of [
      ['Suite health', 'health', 'Suite health'],
      ['Errors', 'errors', 'Errors'],
      ['Overview', '', 'Overview'],
    ] as const) {
      await page.getByRole('link', { name: new RegExp(`^${name}`) }).click();
      await page.getByRole('heading', { level: 1, name: heading }).waitFor();
      expect(page.url()).toMatch(new RegExp(`#/${path}$`));
      expect(await page.getByRole('link', { name: new RegExp(`^${name}`) }).getAttribute('aria-current')).toBe('page');
    }

    await page.goBack();
    await page.getByRole('heading', { level: 1, name: 'Errors' }).waitFor();
    expect(errors).toEqual([]);
    await page.close();
  });

  it('redirects the former run errors route to the errors view', async () => {
    const url = writeReport('redirect', report);
    const { page, errors } = await open(`${url}#/run-errors`);
    await page.getByRole('heading', { level: 1, name: 'Errors' }).waitFor();
    expect(page.url()).toMatch(/#\/errors$/);
    // Replaced, not pushed: Back does not return to the former route.
    await page.goto(`${url}#/health`);
    await page.evaluate("window.location.hash = '#/run-errors'");
    await page.getByRole('heading', { level: 1, name: 'Errors' }).waitFor();
    expect(page.url()).toMatch(/#\/errors$/);
    await page.goBack();
    await page.getByRole('heading', { level: 1, name: 'Suite health' }).waitFor();
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
    await page.getByRole('link', { name: /^Errors/ }).click();
    await page.locator('.run-error').first().waitFor();
    expect(await page.locator('.run-error').count()).toBe(report.run.errors.length);
    expect(errors).toEqual([]);
    await page.close();
  });

  /** Pass rate as the report shows it: passed / (total − skipped). */
  function expectedPassRate(stats: { total: number; passed: number; skipped: number }): string {
    return `${Math.round((stats.passed / (stats.total - stats.skipped)) * 100)}%`;
  }

  it.each(['light', 'dark'] as const)('renders the overview in the %s theme, with the embedded font', async (colorScheme) => {
    const { page, errors } = await open(writeReport(`overview-${colorScheme}`, report), { colorScheme });
    const verdict = page.locator('.verdict-outcome');
    await verdict.waitFor();
    expect(await verdict.getAttribute('data-verdict')).toBe('failed');
    expect(await verdict.textContent()).toBe('Failed');
    // Verdict, run errors, error categories, projects: no error group list.
    expect(await page.locator('.widget h2').allTextContents()).toEqual([
      'Verdict',
      `${report.run.errors.length} error outside tests`,
      'Error categories',
      'Projects',
    ]);
    expect(await page.locator('.group-row').count()).toBe(0);
    const { stats } = report.run;
    expect(await page.locator('.outcome-bar-part').count()).toBe(['passed', 'failed', 'flaky', 'skipped'].filter((key) => stats[key as 'passed'] > 0).length);
    expect(await page.locator('.outcome-bar').getAttribute('aria-label')).toBe(
      `${stats.passed} passed, ${stats.failed} failed, ${stats.flaky} flaky, ${stats.skipped} skipped`,
    );
    // The legend shows counts, not percentages.
    expect(await page.locator('.outcome-legend li').allTextContents()).toEqual(
      (['passed', 'failed', 'flaky', 'skipped'] as const).filter((key) => stats[key] > 0).map((key) => `${stats[key]} ${key}`),
    );
    // One pass rate definition, labeled, explained in a tooltip.
    const rate = page.locator('.widget-verdict .pass-rate');
    expect(await rate.locator('strong').textContent()).toBe(expectedPassRate(stats));
    expect(await rate.textContent()).toContain('pass rate');
    expect(await rate.getAttribute('title')).toContain('Skipped tests are excluded');
    for (const project of report.projects) {
      const card = page.locator('.project-card', { hasText: project.name });
      expect(await card.locator('.pass-rate strong').textContent()).toBe(expectedPassRate(project.stats));
      expect(await card.locator('.pass-rate').getAttribute('title')).toContain('Skipped tests are excluded');
    }

    const background = await page.evaluate<string>('getComputedStyle(document.body).backgroundColor');
    expect(background).toBe(colorScheme === 'light' ? 'rgb(247, 245, 240)' : 'rgb(8, 8, 8)');
    // String expressions: the test tsconfig has no DOM types.
    const badgeColors = await page.evaluate<string[]>(
      "(({ color, backgroundColor }) => [color, backgroundColor])(getComputedStyle(document.querySelector('.widget-categories .category-badge')))",
    );
    expect(new Set(badgeColors).size).toBe(2);
    expect(await page.locator('.wordmark').textContent()).toBe('Loupe');
    expect(await page.locator('.footer').textContent()).toContain(`Loupe — a reporter for Playwright · v${report.generator.version}`);
    expect(await page.evaluate<boolean>('document.fonts.ready.then(() => document.fonts.check(\'600 16px "DM Sans"\'))')).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  });

  /** Bounding box of the first element matching `selector`. */
  async function box(page: Page, selector: string): Promise<{ x: number; y: number; width: number; height: number }> {
    const result = await page.locator(selector).first().boundingBox();
    if (!result) throw new Error(`${selector} is not visible`);
    return result;
  }

  it.each([
    ['light', 1600],
    ['dark', 1600],
    ['light', 700],
    ['dark', 700],
  ] as const)('lays out the views at %s, %ipx wide', async (colorScheme, width) => {
    const page = await browser.newPage({ colorScheme, viewport: { width, height: 1200 } });
    const url = writeReport(`layout-${colorScheme}-${width}`, report);
    await page.goto(url);
    await page.locator('.widget-projects').waitFor();
    // Overview: one column, in order, full width.
    const boxes = await Promise.all(['.widget-verdict', '.widget-run-errors', '.widget-categories', '.widget-projects'].map((selector) => box(page, selector)));
    for (const [previous, next] of boxes.slice(0, -1).map((current, index) => [current, boxes[index + 1]!] as const)) {
      expect(next.y).toBeGreaterThan(previous.y + previous.height);
      expect(Math.abs(next.width - previous.width)).toBeLessThan(2);
    }
    // Project cards fill their row.
    const cards = await page.locator('.project-card').evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().right));
    const list = await box(page, '.project-cards');
    expect(Math.max(...cards)).toBeCloseTo(list.x + list.width, 0);
    const noHorizontalScroll = "document.querySelector('.main').scrollWidth <= document.querySelector('.main').clientWidth";
    expect(await page.evaluate<boolean>(noHorizontalScroll)).toBe(true);

    // Suite health: dimension widgets two by two when wide, stacked when narrow.
    await page.goto(`${url}#/health`);
    await page.locator('.widget-dimension').first().waitFor();
    const [first, second] = await Promise.all([0, 1].map(async (index) => (await page.locator('.widget-dimension').nth(index).boundingBox())!));
    if (width > 900) expect(Math.abs(first!.y - second!.y)).toBeLessThan(2);
    else expect(second!.y).toBeGreaterThan(first!.y + first!.height);
    expect(await page.evaluate<boolean>(noHorizontalScroll)).toBe(true);
    await page.close();
  });

  it('links each overview category to that category in the errors view', async () => {
    const { page, errors } = await open(writeReport('category-links', report), { viewport: { width: 1400, height: 700 } });
    const name = report.categories[report.categories.length - 1]?.name ?? '';
    await page.locator('.category-bar-row', { hasText: name }).click();
    const target = page.locator(`.widget-categories [data-category="${name}"]`);
    await target.locator('details[open]').waitFor();
    expect(page.url()).toMatch(new RegExp(`#/errors/category/${encodeURIComponent(name)}$`));
    // Scrolled to it, its summary focused, its groups shown.
    await expect.poll(() => target.evaluate(
      (element) => element.getBoundingClientRect().top >= 0 && element.getBoundingClientRect().top < (element.ownerDocument.defaultView?.innerHeight ?? 0),
    )).toBe(true);
    expect(await page.evaluate<string>("document.activeElement?.closest('[data-category]')?.dataset.category ?? ''")).toBe(name);
    expect(await target.locator('a.group-row').count()).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    await page.close();
  });

  it('links error groups to their page and to the tests', async () => {
    const { page, errors } = await open(`${writeReport('dashboard-links', report)}#/errors`);
    const firstGroup = page.locator('.widget-groups a.group-row').first();
    const signature = decodeURIComponent((await firstGroup.getAttribute('href'))?.replace(/^#\/group\//, '') ?? '');
    const affected = report.tests.filter((test) => test.attempts.some((attempt) => attempt.errors.some((error) => error.signature === signature)));
    const split = (['failed', 'flaky'] as const)
      .map((outcome) => [outcome, affected.filter((test) => test.outcome === outcome).length] as const)
      .filter(([, count]) => count > 0)
      .map(([outcome, count]) => `${count} ${outcome}`)
      .join('');
    expect(await firstGroup.locator('.group-split').textContent()).toBe(split);
    // The signature hash is not on the rows: it stays on the group page.
    expect(await page.locator('.widget-groups').textContent()).not.toContain(signature);
    await firstGroup.click();
    await page.locator('.group-sample').waitFor();
    expect(page.url()).toMatch(new RegExp(`#/group/${signature}$`));
    expect(await page.locator('.group-meta .group-split').textContent()).toBe(split);
    expect(await page.locator('.group-meta code').textContent()).toBe(signature);
    expect(await page.locator('.affected-tests tbody tr').count()).toBe(affected.length);

    const testLink = page.locator('.affected-tests tbody a').first();
    const title = ((await testLink.textContent()) ?? '').split(' › ').pop() ?? '';
    await testLink.click();
    await page.getByRole('heading', { level: 1, name: title }).waitFor();
    expect(page.url()).toMatch(/#\/test\/[0-9a-f]{16}$/);

    await page.goto(`${page.url().split('#')[0]}#/health`);
    await page.locator('.widget-slowest a').first().click();
    await page.locator('.test-title').waitFor();
    expect(page.url()).toMatch(/#\/test\//);

    await page.goto(`${page.url().split('#')[0]}#/group/000000000000`);
    await page.getByText('No error group with this signature in this report.').waitFor();
    expect(errors).toEqual([]);
    await page.close();
  });

  it('lists run errors, every error group and the categories in the errors view', async () => {
    const { page, errors } = await open(`${writeReport('errors-view', report)}#/errors`);
    await page.locator('.widget-groups').waitFor();
    expect(await page.locator('.widget h2').allTextContents()).toEqual([
      `${report.run.errors.length} run error`,
      `${new Set(report.tests.flatMap((test) => test.attempts.flatMap((attempt) => attempt.errors.map((error) => error.signature)))).size} error groups`,
      'Error categories',
    ]);
    expect(await page.locator('.run-error').count()).toBe(report.run.errors.length);
    // Most failed tests first, then most flaky.
    const splits = await page.locator('.widget-groups .group-row .group-split').allTextContents();
    const failedCounts = splits.map((text) => Number(/(\d+) failed/.exec(text)?.[1] ?? 0));
    expect(failedCounts).toEqual([...failedCounts].sort((a, b) => b - a));
    const category = page.locator('.widget-categories details').first();
    await category.locator('summary').click();
    expect(await category.locator('a.group-row').count()).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    await page.close();
  });

  it('shows dimensions as bars with tag hygiene, and slow, flaky and skipped tests, in the suite health view', async () => {
    // A case variant of a declared value: flagged, counted apart.
    const tests = report.tests.map((test, index) => (index === 0 ? { ...test, dimensions: { ...test.dimensions, Layer: ['API'] } } : test));
    const { page, errors } = await open(`${writeReport('health-view', { ...report, tests })}#/health`);
    await page.locator('.widget-dimension').first().waitFor();
    const headings = await page.locator('.widget h2').allTextContents();
    expect(headings).toEqual([...report.dimensions.map((dimension) => dimension.name), 'Slowest tests', 'Flaky tests', 'Skipped tests']);
    const layer = page.locator('[data-dimension="Layer"]');
    expect(await layer.getAttribute('data-representation')).toBe('bars');
    // One stacked bar per value, labeled with its counts.
    const api = layer.locator('.dimension-bar-row[data-value="api"]');
    expect(await api.locator('.dimension-bar').getAttribute('aria-label')).toMatch(/^api: \d+ passed, \d+ failed/);
    expect(await layer.locator('.dimension-bar-row[data-value="API"] .flag-case').textContent()).toContain('likely duplicate of api');
    expect(await api.locator('.flag-case').textContent()).toContain('likely duplicate of API');
    expect(await layer.locator('.dimension-bars .flag-unknown').count()).toBeGreaterThan(0);
    expect(await layer.locator('.widget-hint').count()).toBe(0);
    // The exact table is one click away.
    const table = layer.locator('.dimension-table');
    expect(await table.locator('table').isVisible()).toBe(false);
    await table.locator('summary').click();
    expect(await table.locator('tbody tr').count()).toBe(await layer.locator('.dimension-bar-row').count());
    // A dimension without declared values points to the option.
    const undeclared = report.dimensions.find((dimension) => dimension.values === null);
    expect(await page.locator(`[data-dimension="${undeclared?.name}"] .widget-hint`).textContent()).toContain('values');
    expect(await page.locator('.widget-flaky .flaky-error').count()).toBe(report.run.stats.flaky);
    expect(errors).toEqual([]);
    await page.close();
  });

  it('shows a dimension with many values as tiles, problem values first, details on focus', async () => {
    // 20 values: tiles. Every test gets one.
    const tests = report.tests.map((test, index) => ({ ...test, dimensions: { ...test.dimensions, module: [`m${String(index % 20).padStart(2, '0')}`] } }));
    const dimensions = [...report.dimensions, { name: 'module', source: 'tag', key: 'module', values: null }];
    const { page, errors } = await open(`${writeReport('tiles', { ...report, tests, dimensions })}#/health`);
    const widget = page.locator('[data-dimension="module"]');
    await widget.waitFor();
    expect(await widget.getAttribute('data-representation')).toBe('tiles');
    const tiles = widget.locator('.dimension-tile');
    expect(await tiles.count()).toBe(20);
    // Summary line, consistent with the tiles.
    const statuses = await tiles.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-status') ?? ''));
    const count = (status: string) => statuses.filter((value) => value === status).length;
    expect(await widget.locator('.tile-summary').textContent()).toMatch(new RegExp(`^20 values · ${count('passed')} all passed · ${count('failed')} with failures`));
    // Problem values first: failed, then flaky, then the rest.
    const rank = { failed: 0, flaky: 1, passed: 2, skipped: 3, none: 4 } as Record<string, number>;
    expect(statuses.map((status) => rank[status])).toEqual([...statuses.map((status) => rank[status])].sort());
    expect(statuses[0]).toBe('failed');
    // Never color alone: each tile has the status icon and, for screen readers, its details as text.
    const first = tiles.first();
    expect(await first.locator('.outcome-icon.outcome-failed').count()).toBe(1);
    expect(await first.locator('.visually-hidden').textContent()).toMatch(/with failures, .*\d+ failed/);
    // Keyboard: focusable, details shown on focus.
    expect(await first.locator('.tile-details').isVisible()).toBe(false);
    await first.focus();
    expect(await first.locator('.tile-details').isVisible()).toBe(true);
    await page.keyboard.press('Tab');
    expect(await tiles.nth(1).evaluate(
      (element) => element === element.ownerDocument.activeElement,
    )).toBe(true);
    // The exact table is still available.
    await widget.locator('.dimension-table summary').click();
    expect(await widget.locator('.dimension-table tbody tr').count()).toBe(20);
    expect(errors).toEqual([]);
    await page.close();
  });

  it('shows one tile tooltip at a time, dismissible, hoverable and persistent (WCAG 1.4.13)', async () => {
    const tests = report.tests.map((test, index) => ({ ...test, dimensions: { ...test.dimensions, module: [`m${String(index % 20).padStart(2, '0')}`] } }));
    const dimensions = [...report.dimensions, { name: 'module', source: 'tag', key: 'module', values: null }];
    const { page, errors } = await open(`${writeReport('tooltips', { ...report, tests, dimensions })}#/health`, {
      viewport: { width: 1400, height: 900 },
    });
    const tiles = page.locator('[data-dimension="module"] .dimension-tile');
    const visibleTooltips = page.locator('.tile-details:visible');
    const first = tiles.nth(0);
    const second = tiles.nth(4);
    await first.scrollIntoViewIfNeeded();

    // Click a tile: it is focused and shows its tooltip, which stays when the pointer leaves.
    await first.click();
    await expect.poll(() => visibleTooltips.count()).toBe(1);
    await page.mouse.move(0, 0);
    expect(await first.locator('.tile-details').isVisible()).toBe(true);

    // Hover another tile: its tooltip replaces the focus one.
    await second.hover();
    await expect.poll(() => visibleTooltips.count()).toBe(1);
    expect(await second.locator('.tile-details').isVisible()).toBe(true);

    // Hoverable: the pointer can move onto the tooltip without closing it.
    const tooltip = await second.locator('.tile-details').boundingBox();
    if (!tooltip) throw new Error('no tooltip box');
    const tile = await second.boundingBox();
    if (!tile) throw new Error('no tile box');
    await page.mouse.move(tile.x + 10, tile.y + 2);
    await page.mouse.move(tooltip.x + 10, tooltip.y + tooltip.height - 2, { steps: 5 });
    await page.mouse.move(tooltip.x + 10, tooltip.y + 4, { steps: 5 });
    expect(await second.locator('.tile-details').isVisible()).toBe(true);

    // Escape closes it without moving focus.
    await page.keyboard.press('Escape');
    await expect.poll(() => visibleTooltips.count()).toBe(0);
    expect(await first.evaluate((element) => element === element.ownerDocument.activeElement)).toBe(true);

    // Moving the pointer away closes a hover tooltip.
    await second.hover();
    await expect.poll(() => visibleTooltips.count()).toBe(1);
    await page.mouse.move(0, 0);
    await expect.poll(() => visibleTooltips.count()).toBe(0);

    // Focusing replaces a hover tooltip; blur closes a focus tooltip.
    await second.hover();
    await page.keyboard.press('Tab');
    await expect.poll(() => visibleTooltips.count()).toBe(1);
    expect(await tiles.nth(1).locator('.tile-details').isVisible()).toBe(true);
    await page.mouse.move(0, 0);
    await page.evaluate("document.activeElement.blur()");
    await expect.poll(() => visibleTooltips.count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  });

  it('reveals a project in the sidebar from its card', async () => {
    const { page } = await open(writeReport('dashboard-interactions', report));

    await page.getByRole('button', { name: 'Collapse all' }).click();
    const project = report.projects[1]?.name ?? '';
    await page.locator('.project-card', { hasText: project }).click();
    const row = page.getByRole('treeitem', { level: 1, name: new RegExp(project) });
    await expect.poll(() => row.getAttribute('aria-expanded')).toBe('true');
    await expect.poll(() => page.evaluate<boolean>(`document.activeElement?.getAttribute('aria-level') === '1' && document.activeElement.textContent.includes(${JSON.stringify(project)})`)).toBe(true);
    expect(await row.getAttribute('class')).toContain('revealed');
    await page.close();
  });

  it('hides the widgets with nothing to show, but always shows the verdict', async () => {
    const empty = { ...report, tests: [], projects: [], dimensions: [], run: { ...report.run, errors: [], status: 'passed', stats: { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0 } } };
    const { page, errors } = await open(writeReport('dashboard-empty', empty));
    await page.locator('.verdict-outcome').waitFor();
    expect(await page.locator('.widget h2').allTextContents()).toEqual(['Verdict']);
    expect(await page.locator('.verdict-outcome').getAttribute('data-verdict')).toBe('passed');
    expect(await page.locator('.nav-marker').count()).toBe(0);
    await page.getByRole('link', { name: /^Errors/ }).click();
    await page.getByText('No errors in this run.').waitFor();
    await page.getByRole('link', { name: /^Suite health/ }).click();
    await page.getByText('No dimension, slow, skipped or flaky test to show for this run.').waitFor();
    await page.getByRole('link', { name: /^Overview/ }).click();

    // Only passing tests: no error, category or skipped widget.
    const passing = report.tests.filter((test) => test.outcome === 'passed');
    const green = {
      ...empty,
      tests: passing,
      projects: report.projects.map((project) => ({ ...project, stats: { ...project.stats, failed: 0, flaky: 0, skipped: 0 } })),
    };
    await page.goto(writeReport('dashboard-green', green));
    await page.locator('.verdict-outcome').waitFor();
    expect(await page.locator('.widget h2').allTextContents()).toEqual(['Verdict', 'Projects']);
    await page.getByRole('link', { name: /^Suite health/ }).click();
    await page.locator('.widget-slowest').waitFor();
    expect(await page.locator('.widget h2').allTextContents()).toEqual(['Slowest tests']);
    expect(errors).toEqual([]);
    await page.close();
  });

  it('shows the skip reason when there is one', async () => {
    const tests = report.tests.map((test) =>
      test.outcome === 'skipped' ? { ...test, annotations: [{ type: 'skip', description: 'needs a payment sandbox' }] } : test,
    );
    const { page } = await open(`${writeReport('dashboard-skip', { ...report, tests })}#/health`);
    await page.locator('.widget-skipped').waitFor();
    expect(await page.locator('.widget-skipped').textContent()).toContain('needs a payment sandbox');
    await page.close();
  });

  it('explains when the data cannot be read', async () => {
    const { page } = await open(writeReport('bad', { schemaVersion: 99 }));
    expect(await page.getByRole('alert').textContent()).toMatch(/Unsupported report schema version 99/);
    await page.close();
  });
});
