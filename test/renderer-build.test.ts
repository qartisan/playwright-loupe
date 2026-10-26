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
import { errorGroups } from '../src/renderer/dashboard.js';
import type { LoupeReport } from '../src/schema/v1.js';
import { ROOT, assertBuilt, isMissingAttachmentFile } from './helpers/fixtures.js';

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
    options: { colorScheme?: 'light' | 'dark'; viewport?: { width: number; height: number }; timezoneId?: string; locale?: string } = {},
  ): Promise<{ page: Page; errors: string[] }> {
    const page = await browser.newPage(options);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      // The sample's attachment files are not next to this temporary report: its videos and images fail to load.
      if (message.type() === 'error' && !isMissingAttachmentFile(message, page)) errors.push(message.text());
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

  it('renders the header, the partial run pill and the sidebar', async () => {
    const { page, errors } = await open(writeReport('sample', report, { ...DEFAULT_RENDERER_SETTINGS, title: 'Sample run' }));
    await expect.poll(() => page.title()).toBe('Overview · Sample run');
    expect(await page.locator('.header .title').textContent()).toBe('Sample run');
    expect(await page.getByRole('link', { name: 'Partial: grep filter. Show details in Run details' }).innerText()).toBe('Partial: grep filter');
    expect(await page.locator('.banner, [role="note"]').count()).toBe(0);
    const nav = page.locator('.nav-fixed .nav-link');
    expect(await nav.locator('span:not(.visually-hidden):not(.badge):not(.nav-marker)').allTextContents()).toEqual(['Overview', 'Errors', 'Suite health', 'Tests']);
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
    // A full run: no partial run pill.
    expect(await page.locator('.scope-pill').count()).toBe(0);
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
    // Verdict, run errors, common failure points (the fixture's shared helper), error categories, projects, run details: no error group list.
    expect(await page.locator('.widget h2').allTextContents()).toEqual([
      'Verdict',
      `${report.run.errors.length} error outside tests`,
      'Common failure points',
      'Error categories',
      'Projects',
      'Run details',
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

  it('links each overview category to its failing tests in the tests view', async () => {
    const { page, errors } = await open(writeReport('category-links', report), { viewport: { width: 1400, height: 700 } });
    // The uncategorized bucket is a category like the others.
    const name = report.categories[report.categories.length - 1]?.name ?? '';
    const row = page.locator('.category-bar-row', { hasText: name });
    const count = Number(/(\d+) tests?/.exec((await row.locator('.group-count').textContent()) ?? '')?.[1]);
    await row.click();
    await page.getByRole('heading', { level: 1, name: 'Tests' }).waitFor();
    expect(page.url()).toMatch(new RegExp(`#/tests\\?category=${encodeURIComponent(name)}$`));
    expect(await page.locator('.tests-table tbody tr').count()).toBe(count);
    expect(await page.locator('.result-count').textContent()).toBe(`${count} of ${report.tests.length} tests`);
    expect(errors).toEqual([]);
    await page.close();
  });

  it('still opens a category in the errors view from its route', async () => {
    const name = report.categories[report.categories.length - 1]?.name ?? '';
    const { page, errors } = await open(`${writeReport('category-route', report)}#/errors/category/${encodeURIComponent(name)}`, { viewport: { width: 1400, height: 700 } });
    const target = page.locator(`.widget-categories [data-category="${name}"]`);
    await target.locator('details[open]').waitFor();
    // Scrolled to it, its summary focused, its groups shown.
    await expect.poll(() => target.evaluate(
      (element) => element.getBoundingClientRect().top >= 0 && element.getBoundingClientRect().top < (element.ownerDocument.defaultView?.innerHeight ?? 0),
    )).toBe(true);
    expect(await page.evaluate<string>("document.activeElement?.closest('[data-category]')?.dataset.category ?? ''")).toBe(name);
    expect(await target.locator('a.group-row').count()).toBeGreaterThan(0);
    expect(await target.locator('a.group-row .category-badge').count()).toBe(0);
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
      // Groups only seen after a test timeout (the fixture's `times out` test) are folded, not counted.
      `${errorGroups(report).filter((group) => !group.afterTimeout).length} error groups`,
      'Error categories',
    ]);
    expect(await page.locator('.run-error').count()).toBe(report.run.errors.length);
    // Most failed tests first, then most flaky; the folded groups come after, in their own disclosure.
    const splits = await page.locator('.widget-groups > .group-list .group-row .group-split').allTextContents();
    const failedCounts = splits.map((text) => Number(/(\d+) failed/.exec(text)?.[1] ?? 0));
    expect(failedCounts).toEqual([...failedCounts].sort((a, b) => b - a));
    const category = page.locator('.widget-categories details').first();
    await category.locator('summary').click();
    expect(await category.locator('a.group-row').count()).toBeGreaterThan(0);
    // Inside a category, its name is on the summary only, not repeated on each group.
    expect(await category.locator('summary .category-badge').count()).toBe(1);
    expect(await category.locator('a.group-row .category-badge').count()).toBe(0);
    // The global list mixes categories: every group keeps its badge.
    const groups = page.locator('.widget-groups a.group-row');
    expect(await groups.locator('.category-badge').count()).toBe(await groups.count());

    // Attempts with the error, out of the attempts of the affected tests, when one of them was retried.
    for (const row of await groups.all()) {
      const signature = decodeURIComponent((await row.getAttribute('href'))?.replace(/^#\/group\//, '') ?? '');
      const affected = report.tests.filter((test) => test.attempts.some((attempt) => attempt.errors.some((error) => error.signature === signature)));
      const failing = affected.reduce(
        (sum, test) => sum + test.attempts.filter((attempt) => attempt.status !== test.expectedStatus && attempt.status !== 'skipped' && attempt.errors.some((error) => error.signature === signature)).length,
        0,
      );
      const total = affected.reduce((sum, test) => sum + test.attempts.length, 0);
      const text = affected.some((test) => test.attempts.length > 1) ? `failed on ${failing} of ${total} attempts` : null;
      expect(await row.locator('.group-attempts').count()).toBe(text === null ? 0 : 1);
      if (text !== null) expect(await row.locator('.group-attempts').textContent()).toBe(text);
    }
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
    // 20 values: tiles. Every test gets one: failed and flaky tests m00 to m09, the others m10 to m19.
    const tests = report.tests.map((test, index) => {
      const module = (test.outcome === 'failed' || test.outcome === 'flaky' ? 0 : 10) + (index % 10);
      return { ...test, dimensions: { ...test.dimensions, module: [`m${String(module).padStart(2, '0')}`] } };
    });
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

    // Focus a tile: it shows its tooltip, which stays when the pointer leaves.
    await first.focus();
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

  it('hides the widgets with nothing to show, but always shows the verdict and the run details', async () => {
    const empty = { ...report, tests: [], projects: [], dimensions: [], run: { ...report.run, errors: [], status: 'passed', stats: { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0 } } };
    const { page, errors } = await open(writeReport('dashboard-empty', empty));
    await page.locator('.verdict-outcome').waitFor();
    expect(await page.locator('.widget h2').allTextContents()).toEqual(['Verdict', 'Run details']);
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
    expect(await page.locator('.widget h2').allTextContents()).toEqual(['Verdict', 'Projects', 'Run details']);
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

  /** Path of the URL fragment: `#/tests?status=failed`. */
  function fragment(page: Page): string {
    return `#${page.url().split('#')[1] ?? ''}`;
  }

  it('links a header count to those tests, replacing the filters, and reduces the sidebar to them', async () => {
    const { page, errors } = await open(`${writeReport('header-counts', report)}#/health?tag=%40smoke`);
    const { stats } = report.run;
    const failed = page.getByRole('link', { name: `${stats.failed} failed` });
    expect(await failed.getAttribute('href')).toBe('#/tests?status=failed');
    // A zero count is not a link.
    const zero = (['passed', 'failed', 'flaky', 'skipped'] as const).find((outcome) => stats[outcome] === 0);
    if (zero) expect(await page.locator('.counts .count.zero a').count()).toBe(0);
    await failed.click();
    await page.getByRole('heading', { level: 1, name: 'Tests' }).waitFor();
    expect(fragment(page)).toBe('#/tests?status=failed');
    expect(await page.locator('.tests-table tbody tr').count()).toBe(stats.failed);
    expect(await page.locator('.tests-table tbody .outcome-failed').count()).toBe(stats.failed);
    // The filtered sidebar opens fully and holds exactly those tests.
    await expect.poll(() => page.locator('.tree-test').count()).toBe(stats.failed);
    expect(await page.locator('.tree-test .outcome-failed').count()).toBe(stats.failed);
    expect(await page.locator('.filter-indicator').textContent()).toContain(`1 filter · ${stats.failed} tests`);
    expect(errors).toEqual([]);
    await page.close();
  });

  it('restores filters and sort from a pasted URL, and normalizes it', async () => {
    const url = writeReport('restore', report);
    const { page, errors } = await open(`${url}#/tests?sort=duration:desc&status=flaky,failed,bogus&unknown=1&tag=%40nope`);
    await page.getByRole('heading', { level: 1, name: 'Tests' }).waitFor();
    // Unknown parameters and values dropped, canonical order, replaced rather than pushed.
    expect(fragment(page)).toBe('#/tests?status=failed,flaky&sort=duration:desc');
    const expected = report.tests.filter((test) => test.outcome === 'failed' || test.outcome === 'flaky').length;
    expect(await page.locator('.tests-table tbody tr').count()).toBe(expected);
    expect(await page.getByRole('columnheader', { name: 'Duration' }).getAttribute('aria-sort')).toBe('descending');
    expect(await page.locator('.chip').allTextContents()).toEqual(['Status: Failed', 'Status: Flaky']);
    // Reloading keeps the state: it lives in the URL.
    await page.reload();
    await page.locator('.tests-table').waitFor();
    expect(await page.locator('.tests-table tbody tr').count()).toBe(expected);
    expect(errors).toEqual([]);
    await page.close();
  });

  it('undoes a clicked filter with Back, and does not fill the history while typing', async () => {
    const { page, errors } = await open(`${writeReport('history', report)}#/tests`);
    await page.locator('.tests-table').waitFor();
    await page.locator('.facet[data-facet="status"] summary').click();
    await page.getByRole('checkbox', { name: /^Failed/ }).check();
    await expect.poll(() => fragment(page)).toBe('#/tests?status=failed');
    await page.getByRole('checkbox', { name: /^Flaky/ }).check();
    await expect.poll(() => fragment(page)).toBe('#/tests?status=failed,flaky');
    await page.goBack();
    await expect.poll(() => fragment(page)).toBe('#/tests?status=failed');
    expect(await page.locator('.chip').allTextContents()).toEqual(['Status: Failed']);

    const length = await page.evaluate<number>('history.length');
    await page.locator('#sidebar-search').pressSequentially('one per', { delay: 30 });
    await expect.poll(() => fragment(page)).toBe('#/tests?q=one%20per&status=failed');
    expect(await page.evaluate<number>('history.length')).toBe(length);
    // Back leaves the search: it replaced the entry of the last clicked filter.
    await page.goBack();
    await expect.poll(() => fragment(page)).toBe('#/tests');
    await expect.poll(() => page.locator('#sidebar-search').inputValue()).toBe('');
    expect(errors).toEqual([]);
    await page.close();
  });

  it('operates the filter bar, the sort and the search with the keyboard, and announces the count', async () => {
    const { page, errors } = await open(`${writeReport('keyboard-filters', report)}#/tests`);
    await page.locator('.tests-table').waitFor();
    const live = page.locator('[aria-live="polite"].result-count');
    expect(await live.textContent()).toBe(`${report.tests.length} tests`);

    const summary = page.locator('.facet[data-facet="status"] summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    expect(await page.locator('.facet[data-facet="status"]').getAttribute('open')).not.toBeNull();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    const failed = report.tests.filter((test) => test.outcome === 'failed').length;
    await expect.poll(() => live.textContent()).toBe(`${failed} of ${report.tests.length} tests`);
    // Escape closes the menu and returns to its button.
    await page.keyboard.press('Escape');
    expect(await page.locator('.facet[data-facet="status"]').getAttribute('open')).toBeNull();
    expect(await summary.evaluate((element) => element === element.ownerDocument.activeElement)).toBe(true);

    // Sorting from a header button.
    const header = page.getByRole('columnheader', { name: 'Test' });
    expect(await header.getAttribute('aria-sort')).toBeNull();
    await header.getByRole('button').focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => header.getAttribute('aria-sort')).toBe('ascending');
    expect(fragment(page)).toBe('#/tests?status=failed&sort=title:asc');

    // Removing a chip with the keyboard keeps the focus in the chip row.
    await page.getByRole('button', { name: 'Remove filter Status: Failed' }).focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => live.textContent()).toBe(`${report.tests.length} tests`);
    expect(await page.evaluate<boolean>("document.activeElement?.matches('.facets summary') ?? false")).toBe(true);

    // `/` focuses the search, Escape clears it.
    await page.locator('body').click({ position: { x: 600, y: 5 } });
    await page.keyboard.press('/');
    expect(await page.evaluate<string>('document.activeElement?.id ?? ""')).toBe('sidebar-search');
    await page.keyboard.type('zzz-no-such-test');
    await page.getByText('No tests match these filters.').waitFor();
    await page.keyboard.press('Escape');
    await expect.poll(() => fragment(page)).toBe('#/tests?sort=title:asc');
    expect(await page.locator('#sidebar-search').inputValue()).toBe('');
    expect(errors).toEqual([]);
    await page.close();
  });

  /** The sample repeated to `count` tests, each with its own id. */
  function manyTests(count: number): LoupeReport {
    const tests = Array.from({ length: count }, (_, index) => {
      const test = report.tests[index % report.tests.length] as LoupeReport['tests'][number];
      return { ...test, id: index.toString(16).padStart(16, '0'), title: `${test.title} #${index}` };
    });
    return { ...report, tests };
  }

  it('caps the tests view at 500 rows, shows more on demand, and resets the cap on any change', async () => {
    const big = manyTests(1200);
    const { page, errors } = await open(`${writeReport('cap', big)}#/tests`);
    const rows = page.locator('.tests-table tbody tr');
    const live = page.locator('[aria-live="polite"].result-count');
    await page.locator('.tests-table').waitFor();
    expect(await rows.count()).toBe(500);
    expect(await live.textContent()).toBe('Showing 500 of 1,200 tests');
    expect(await page.locator('.table-more p').textContent()).toBe('Showing 500 of 1,200 tests');

    // More rows; focus moves to the first added one.
    await page.getByRole('button', { name: 'Show 500 more' }).click();
    await expect.poll(() => rows.count()).toBe(1000);
    expect(await rows.nth(500).locator('.cell-title > a').evaluate((element) => element === element.ownerDocument.activeElement)).toBe(true);
    expect(await page.getByRole('button', { name: 'Show 200 more' }).count()).toBe(1);
    await page.getByRole('button', { name: 'Show all' }).click();
    await expect.poll(() => rows.count()).toBe(1200);
    expect(await live.textContent()).toBe('1,200 tests');
    expect(await page.locator('.table-more').count()).toBe(0);

    // A sort change starts again from 500, and the first rows are those of the new order.
    await page.getByRole('button', { name: 'Duration' }).click();
    await expect.poll(() => rows.count()).toBe(500);
    const longest = Math.max(...big.tests.map((test) => test.durationMs));
    const longestTitles = big.tests.filter((test) => test.durationMs === longest).map((test) => [...test.suitePath, test.title].join(' › '));
    expect(longestTitles).toContain(await rows.first().locator('.cell-title > a').textContent());

    // So does a filter change, even back to a state shown in full before.
    await page.getByRole('button', { name: 'Show all' }).click();
    await expect.poll(() => rows.count()).toBe(1200);
    await page.locator('.facet[data-facet="status"] summary').click();
    await page.getByRole('checkbox', { name: /^Failed/ }).check();
    const failed = big.tests.filter((test) => test.outcome === 'failed').length;
    await expect.poll(() => live.textContent()).toBe(`Showing 500 of ${failed} matching tests (1,200 in total)`);
    await page.getByRole('checkbox', { name: /^Failed/ }).uncheck();
    await expect.poll(() => live.textContent()).toBe('Showing 500 of 1,200 tests');
    expect(await rows.count()).toBe(500);
    expect(errors).toEqual([]);
    await page.close();
  });

  it('shows the primary category of a test and +N for the other categories of its failing attempts', async () => {
    const index = report.tests.findIndex((test) => test.outcome === 'failed' && test.attempts.length > 1);
    const original = report.tests[index] as LoupeReport['tests'][number];
    const withCategory = (attempt: (typeof original.attempts)[number], category: string) => ({
      ...attempt,
      errors: attempt.errors.map((error) => ({ ...error, category })),
    });
    const mixed = {
      ...original,
      category: 'Network',
      attempts: original.attempts.map((attempt, position) => withCategory(attempt, position === 0 ? 'Timeout' : 'Network')),
    };
    const tests = report.tests.map((test, position) => (position === index ? mixed : test));
    const { page, errors } = await open(`${writeReport('category-more', { ...report, tests })}#/tests?category=Timeout`);
    const row = page.locator('.tests-table tbody tr', { hasText: original.title }).first();
    await row.waitFor();
    // Filtered on Timeout, the row shows its primary category, Network, and +1.
    expect(await row.locator('.category-badge').allTextContents()).toEqual(['Network']);
    const more = row.locator('.category-more');
    expect(await more.locator('[aria-hidden="true"]').textContent()).toBe('+1');
    expect(await more.getAttribute('title')).toBe('Other category in failing attempts: Timeout');
    expect(await more.locator('.visually-hidden').textContent()).toBe(', and 1 other category: Timeout');
    expect(errors).toEqual([]);
    await page.close();
  });

  it('filters a tag a dimension takes through the dimension only, so two facets never AND into nothing', async () => {
    const url = writeReport('dimension-tags', report);
    // The dogfooding case: @layer:ui in Tag and api in Layer.
    const { page, errors } = await open(`${url}#/tests?tag=%40layer%3Aui&dim.Layer=api`);
    await page.locator('.tests-table').waitFor();
    // The tag is dropped and the URL normalized: the Layer filter alone remains.
    expect(fragment(page)).toBe('#/tests?dim.Layer=api');
    const api = report.tests.filter((test) => test.dimensions['Layer']?.includes('api')).length;
    expect(api).toBeGreaterThan(0);
    expect(await page.locator('.tests-table tbody tr').count()).toBe(api);
    expect(await page.locator('.chip').allTextContents()).toEqual(['Layer: api']);

    // The Tag facet offers no @layer: tag; Layer offers ui and api.
    await page.locator('.facet[data-facet="tag"] summary').click();
    const tags = await page.locator('.facet[data-facet="tag"] .facet-option .facet-value').allTextContents();
    expect(tags).toContain('@smoke');
    expect(tags.filter((tag) => tag.startsWith('@layer:') || tag.startsWith('@area:'))).toEqual([]);
    await page.keyboard.press('Escape');
    await page.locator('.facet[data-facet="dim.Layer"] summary').click();
    expect(await page.locator('.facet[data-facet="dim.Layer"] .facet-value').allTextContents()).toEqual(expect.arrayContaining(['api', 'ui']));
    expect(errors).toEqual([]);
    await page.close();

    // Without tags left once the dimension tags are out, the Tag facet is hidden.
    const dimensionTagsOnly = { ...report, tests: report.tests.map((test) => ({ ...test, tags: test.tags.filter((tag) => tag.includes(':')) })) };
    const second = await open(`${writeReport('dimension-tags-only', dimensionTagsOnly)}#/tests`);
    await second.page.locator('.facets').waitFor();
    expect(await second.page.locator('.facet[data-facet="tag"]').count()).toBe(0);
    expect(await second.page.locator('.facet[data-facet="dim.Layer"]').count()).toBe(1);
    expect(second.errors).toEqual([]);
    await second.page.close();
  });

  it('orders the facets status, error category, failure point, project, tag, then dimensions, and labels categories as error categories', async () => {
    const category = report.categories[0]?.name ?? '';
    const { page, errors } = await open(`${writeReport('facet-order', report)}#/tests?dim.Layer=api&project=chromium-a&category=${encodeURIComponent(category)}&status=failed`);
    await page.locator('.filter-chips').waitFor();
    // Dimensions in config order: Layer and Bug (configured), then area (automatic).
    expect(await page.locator('.facet-button > span:first-child').allTextContents()).toEqual(['Status', 'Error category', 'Failure point', 'Project', 'Tag', 'Layer', 'Bug', 'area']);
    // Chips follow the same order; the URL keeps its own canonical order and the `category` parameter.
    expect(await page.locator('.chip').allTextContents()).toEqual(['Status: Failed', `Error category: ${category}`, 'Project: chromium-a', 'Layer: api']);
    expect(fragment(page)).toBe(`#/tests?status=failed&project=chromium-a&dim.Layer=api&category=${encodeURIComponent(category)}`);
    expect(await page.getByRole('button', { name: `Remove filter Error category: ${category}` }).count()).toBe(1);
    // The checkbox group is named after the facet once its menu is open.
    await page.locator('.facet[data-facet="category"] summary').click();
    expect(await page.getByRole('group', { name: 'Error category' }).count()).toBe(1);
    await page.keyboard.press('Escape');
    // The table may be empty with these filters: the header is checked without them.
    await page.getByRole('button', { name: 'Clear all' }).click();
    await page.locator('.tests-table').waitFor();
    expect(await page.getByRole('columnheader', { name: 'Error category' }).count()).toBe(1);
    expect(errors).toEqual([]);
    await page.close();
  });

  it('shows dimension values and free tags as chips under each test title', async () => {
    const { page, errors } = await open(`${writeReport('chips', report)}#/tests?project=chromium-a`);
    await page.locator('.tests-table').waitFor();
    const row = page.locator('.tests-table tbody tr', { hasText: 'runs nested steps' });
    const chips = row.locator('.cell-title .test-chips');
    // Under the title, next to its link and never inside it.
    expect(await row.locator('.cell-title > a + .test-chips, .cell-title > .row-note + .test-chips').count()).toBe(1);
    expect(await page.locator('.tests-table a a, .tests-table a button').count()).toBe(0);
    // Dimensions in config order (Layer, Bug, area), then free tags; a tag a dimension takes is not repeated.
    expect(await chips.locator('.test-chip').allTextContents()).toEqual(['ui', 'checkout', '@smoke']);
    expect(await chips.getByRole('link').evaluateAll((links) => links.map((link) => [link.getAttribute('aria-label'), link.getAttribute('title')]))).toEqual([
      ['Layer: ui', 'Layer: ui'],
      ['area: checkout', 'area: checkout'],
      ['Tag: @smoke', 'Tag: @smoke'],
    ]);
    expect(await row.getByRole('group', { name: 'Tags and dimensions' }).count()).toBe(1);
    // An annotation-based dimension is a chip too.
    const bug = page.locator('.tests-table tbody tr', { hasText: 'fails on a wrong heading' });
    expect(await bug.locator('.test-chip').allTextContents()).toEqual(['ui', 'BUG-1']);
    // No chip line for a test without tags or dimensions.
    const bare = report.tests.find((test) => test.project === 'chromium-a' && test.tags.length === 0 && Object.values(test.dimensions).every((values) => values.length === 0));
    if (bare) {
      const bareRow = page.locator('.tests-table tbody tr', { has: page.getByRole('link', { name: [...bare.suitePath, bare.title].join(' › '), exact: true }) });
      expect(await bareRow.locator('.test-chips').count()).toBe(0);
    }
    expect(errors).toEqual([]);
    await page.close();
  });

  it('adds a chip value to the filter, removes it from an active chip, and undoes either with Back', async () => {
    const { page, errors } = await open(`${writeReport('chip-links', report)}#/tests?status=passed&sort=duration:desc`);
    await page.locator('.tests-table').waitFor();
    const rows = page.locator('.tests-table tbody tr');
    const ui = page.getByRole('link', { name: 'Layer: ui', exact: true }).first();
    expect(await ui.getAttribute('href')).toBe('#/tests?status=passed&dim.Layer=ui&sort=duration:desc');
    await ui.click();
    await expect.poll(() => fragment(page)).toBe('#/tests?status=passed&dim.Layer=ui&sort=duration:desc');
    const expected = report.tests.filter((test) => test.outcome === 'passed' && test.dimensions['Layer']?.includes('ui')).length;
    await expect.poll(() => rows.count()).toBe(expected);
    expect(await page.locator('.chip').allTextContents()).toEqual(['Status: Passed', 'Layer: ui']);

    // Every ui chip is now active, and its link removes the value.
    const active = page.getByRole('link', { name: 'Remove filter Layer: ui', exact: true });
    expect(await active.count()).toBe(expected);
    expect(await page.locator('.test-chip-active').count()).toBe(expected);
    expect(await active.first().getAttribute('href')).toBe('#/tests?status=passed&sort=duration:desc');
    await active.first().click();
    await expect.poll(() => fragment(page)).toBe('#/tests?status=passed&sort=duration:desc');

    // Back undoes the removal, then the addition.
    await page.goBack();
    await expect.poll(() => fragment(page)).toBe('#/tests?status=passed&dim.Layer=ui&sort=duration:desc');
    await page.goBack();
    await expect.poll(() => fragment(page)).toBe('#/tests?status=passed&sort=duration:desc');
    expect(errors).toEqual([]);
    await page.close();
  });

  it('caps the chips of a row at four, the rest behind a +N button operable with the keyboard', async () => {
    const index = report.tests.findIndex((test) => test.title === 'runs nested steps' && test.project === 'chromium-a');
    const original = report.tests[index] as LoupeReport['tests'][number];
    const tagged = { ...original, tags: [...original.tags, '@regression', '@nightly', '@a11y', '@slow'] };
    const tests = report.tests.map((test, position) => (position === index ? tagged : test));
    const { page, errors } = await open(`${writeReport('chip-cap', { ...report, tests })}#/tests?project=chromium-a`);
    await page.locator('.tests-table').waitFor();
    const chips = page.locator('.tests-table tbody tr', { hasText: 'runs nested steps' }).locator('.test-chips');
    expect(await chips.locator('.test-chip').allTextContents()).toEqual(['ui', 'checkout', '@a11y', '@nightly']);
    const more = chips.getByRole('button', { name: '+3 more tags and dimensions' });
    expect(await more.getAttribute('aria-expanded')).toBe('false');
    await more.focus();
    await page.keyboard.press('Enter');
    expect(await chips.locator('.test-chip').allTextContents()).toEqual(['ui', 'checkout', '@a11y', '@nightly', '@regression', '@slow', '@smoke']);
    const less = chips.getByRole('button', { name: 'Show less' });
    expect(await less.getAttribute('aria-expanded')).toBe('true');
    expect(await less.evaluate((element) => element === element.ownerDocument.activeElement)).toBe(true);
    // The expanded chips are links in the tab order; Space collapses the row again.
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate<string | null>("document.activeElement.getAttribute('aria-label')")).toBe('Tag: @smoke');
    await less.focus();
    await page.keyboard.press('Space');
    expect(await chips.locator('.test-chip').count()).toBe(4);
    // Not in the URL.
    expect(fragment(page)).toBe('#/tests?project=chromium-a');
    expect(errors).toEqual([]);
    await page.close();
  });

  it('never hides an active chip behind +N in a collapsed row', async () => {
    const index = report.tests.findIndex((test) => test.title === 'runs nested steps' && test.project === 'chromium-a');
    const original = report.tests[index] as LoupeReport['tests'][number];
    const tagged = { ...original, tags: [...original.tags, '@regression', '@nightly', '@a11y', '@slow'] };
    const tests = report.tests.map((test, position) => (position === index ? tagged : test));
    // @slow and @smoke are the 6th and 7th chips: both active, so both shown.
    const { page, errors } = await open(`${writeReport('chip-active-cap', { ...report, tests })}#/tests?project=chromium-a&tag=%40slow,%40smoke`);
    await page.locator('.tests-table').waitFor();
    const chips = page.locator('.tests-table tbody tr', { hasText: 'runs nested steps' }).locator('.test-chips');
    expect(await chips.locator('.test-chip').allTextContents()).toEqual(['ui', 'checkout', '@slow', '@smoke']);
    expect(await chips.locator('.test-chip-active').allTextContents()).toEqual(['@slow', '@smoke']);
    expect(await chips.getByRole('button', { name: '+3 more tags and dimensions' }).count()).toBe(1);
    // Expanded, every chip in its normal order.
    await chips.getByRole('button', { name: '+3 more tags and dimensions' }).click();
    expect(await chips.locator('.test-chip').allTextContents()).toEqual(['ui', 'checkout', '@a11y', '@nightly', '@regression', '@slow', '@smoke']);
    expect(errors).toEqual([]);
    await page.close();
  });

  it('finds tests by tag and by dimension value from the search', async () => {
    const { page, errors } = await open(`${writeReport('search-tags', report)}#/tests?q=smoke`);
    const rows = page.locator('.tests-table tbody tr');
    await page.locator('.tests-table').waitFor();
    const smoke = report.tests.filter((test) => test.tags.includes('@smoke')).length;
    expect(smoke).toBeGreaterThan(0);
    expect(await rows.count()).toBe(smoke);
    await page.goto(`${page.url().split('#')[0]}#/tests?q=api`);
    // `api` also matches titles and files: at least every test with the value.
    const api = report.tests.filter((test) => test.dimensions['Layer']?.includes('api')).length;
    await expect.poll(async () => (await rows.count()) >= api && (await rows.count()) < report.tests.length).toBe(true);
    await page.goto(`${page.url().split('#')[0]}#/tests?q=layer%3Aapi`);
    await expect.poll(() => rows.count()).toBe(api);
    expect(errors).toEqual([]);
    await page.close();
  });

  it('shows an empty state with a reset button', async () => {
    const { page, errors } = await open(`${writeReport('empty-state', report)}#/tests?q=zzz-no-such-test&sort=title:desc`);
    await page.getByText('No tests match these filters.').waitFor();
    expect(await page.locator('.tree-empty').textContent()).toBe('No tests match the filters.');
    await page.getByRole('button', { name: 'Reset filters' }).click();
    await page.locator('.tests-table').waitFor();
    expect(fragment(page)).toBe('#/tests?sort=title:desc');
    expect(errors).toEqual([]);
    await page.close();
  });

  it('links suite health dimension values to their tests', async () => {
    const { page, errors } = await open(`${writeReport('dimension-links', report)}#/health`);
    const layer = page.locator('[data-dimension="Layer"]');
    const value = layer.locator('.dimension-bar-row[data-value="api"] a.dimension-value');
    expect(await value.getAttribute('href')).toBe('#/tests?dim.Layer=api');
    // The exact table links the same way.
    await layer.locator('.dimension-table summary').click();
    expect(await layer.locator('.dimension-table tbody a', { hasText: 'api' }).getAttribute('href')).toBe('#/tests?dim.Layer=api');
    await value.click();
    await page.getByRole('heading', { level: 1, name: 'Tests' }).waitFor();
    const expected = report.tests.filter((test) => test.dimensions['Layer']?.includes('api')).length;
    expect(await page.locator('.tests-table tbody tr').count()).toBe(expected);
    // The summaries ignore the filters; the sidebar keeps them.
    await page.getByRole('link', { name: /^Overview/ }).click();
    await page.locator('.verdict-outcome').waitFor();
    expect(fragment(page)).toBe('#/?dim.Layer=api');
    expect(await page.locator('.outcome-legend').textContent()).toContain(`${report.run.stats.passed} passed`);
    expect(await page.locator('.filter-indicator').textContent()).toContain(`${expected} tests`);
    expect(errors).toEqual([]);
    await page.close();
  });

  it('groups the sidebar by folder below the common prefix, file names cut in the middle', async () => {
    const files: Record<string, string> = {
      'basics.spec.ts': 'tests/e2e/api/users/basics.spec.ts',
      'failures.spec.ts': 'tests/e2e/checkout/failures.spec.ts',
      'outcomes.spec.ts': 'tests/e2e/checkout/outcomes.spec.ts',
      'structure.spec.ts': 'tests/e2e/structure-and-organisation-of-the-describe-blocks-in-a-long-file.spec.ts',
      'redaction.spec.ts': 'tests/e2e/checkout/redaction.spec.ts',
      'resources/invoices.spec.ts': 'tests/e2e/resources/invoices.spec.ts',
      'resources/orders.spec.ts': 'tests/e2e/resources/orders.spec.ts',
      'resources/profiles.spec.ts': 'tests/e2e/resources/profiles.spec.ts',
    };
    const tests = report.tests.map((test) => ({ ...test, file: files[test.file] ?? test.file }));
    const { page, errors } = await open(writeReport('folders', { ...report, tests }), { viewport: { width: 1400, height: 900 } });
    await page.getByRole('button', { name: 'Expand all' }).click();
    expect(await page.locator('.tree-prefix').textContent()).toBe('Files in tests/e2e/');
    // Visible labels only: the accessible name of a file holds its full path.
    const labels = await page.locator('.tree .label-part:not(.file-name), .tree .name-head').allTextContents();
    expect(labels.filter((label) => label.includes('tests/e2e'))).toEqual([]);
    const firstProject = page.getByRole('treeitem', { level: 1 }).first();
    expect(await firstProject.getAttribute('aria-expanded')).toBe('true');
    // Single-child folders merged on one line; folders before files.
    const folders = await page.locator('.tree-folder').first().locator('.row-label').textContent();
    expect(folders).toBe('api/users');
    // A long name keeps its start and its extension; the full path is in the tooltip and the accessible name.
    const file = page.locator('.tree-file', { has: page.locator('.name-head', { hasText: /^structure-and/ }) }).first();
    expect(await file.locator('.name-tail').textContent()).toBe('file.spec.ts');
    expect(await file.locator('.row-label').getAttribute('title')).toMatch(/^tests\/e2e\/structure-and-organisation-of-the-describe-blocks-in-a-long-file\.spec\.ts/);
    expect(await file.locator('.visually-hidden').first().textContent()).toBe(files['structure.spec.ts']);
    const clipped = await file.locator('.name-head').evaluate((element) => element.scrollWidth > element.clientWidth);
    expect(clipped).toBe(true);
    expect(await file.locator('.name-tail').isVisible()).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  });

  it('leaves out the test directory of each project, and names it in the project row', async () => {
    // Projects that share their files (the fixture report): no own prefix, rows unchanged.
    const shared = await open(writeReport('project-prefix-shared', report));
    expect(await shared.page.locator('.tree [role="treeitem"][aria-level="1"] .row-label').allTextContents()).toEqual(['chromium-a', 'chromium-b']);
    expect(await shared.page.getByRole('treeitem', { level: 1, name: /files in/ }).count()).toBe(0);
    expect(shared.errors).toEqual([]);
    await shared.page.close();

    // Projects with their own test directory, as in the demo suite.
    const directories: Record<string, string> = { 'chromium-a': 'web/', 'chromium-b': 'api/' };
    const tests = report.tests.map((test) => ({ ...test, file: `${directories[test.project]}${test.file}` }));
    const { page, errors } = await open(writeReport('project-prefix-own', { ...report, tests }));
    // Nothing is shared by every file: no line above the tree.
    expect(await page.locator('.tree-prefix').count()).toBe(0);
    // Accessible name: "chromium-a , files in web/ …" (Chromium adds a space between the spans).
    const web = page.getByRole('treeitem', { level: 1, name: /^chromium-a\s*, files in web\// });
    expect(await web.count()).toBe(1);
    expect(await web.locator('.row-label').getAttribute('title')).toBe('chromium-a, files in web/');
    // The visible label stays the project name.
    expect(await web.locator('.label-part').allTextContents()).toEqual(['chromium-a']);
    expect(await page.getByRole('treeitem', { level: 1, name: /^chromium-b\s*, files in api\// }).count()).toBe(1);
    // No folder repeats the project's directory; the folders below it stay.
    const folders = await page.locator('.tree-folder .row-label').allTextContents();
    expect(folders).not.toContain('web');
    expect(folders).not.toContain('api');
    expect(folders).toContain('resources');
    expect(errors).toEqual([]);
    await page.close();
  });

  it('shows the run start in the viewer time zone, with details on focus', async () => {
    const { page, errors } = await open(writeReport('run-time', report), { timezoneId: 'Europe/Paris', locale: 'en-GB' });
    const time = page.locator('.run-time time');
    expect(await time.getAttribute('datetime')).toBe(new Date(report.run.startedAt).toISOString());
    expect(await time.textContent()).toMatch(/^\d{1,2} \w{3} \d{4}, \d{2}:\d{2} CES?T$/);
    const details = page.locator('#run-time-details');
    expect(await details.isVisible()).toBe(false);
    await time.focus();
    expect(await details.isVisible()).toBe(true);
    expect(await details.textContent()).toContain('Time zone: Europe/Paris');
    expect(await details.textContent()).toContain(`UTC: ${new Date(report.run.startedAt).toISOString()}`);
    expect(await time.getAttribute('aria-describedby')).toBe('run-time-details');
    // Escape hides it without moving focus.
    await page.keyboard.press('Escape');
    expect(await details.isVisible()).toBe(false);
    expect(await time.evaluate((element) => element === element.ownerDocument.activeElement)).toBe(true);
    await page.close();

    // Without a valid start: no date, the duration alone, no error.
    const broken = await open(writeReport('run-time-missing', { ...report, run: { ...report.run, startedAt: 'garbage' } }));
    await broken.page.locator('.run-time').waitFor();
    expect(await broken.page.locator('.run-time time').count()).toBe(0);
    expect(await broken.page.locator('.run-time dd').textContent()).toMatch(/^\d[\d.]* (?:ms|s|min)\b[^·]*$/);
    expect([...errors, ...broken.errors]).toEqual([]);
    await broken.page.close();
  });

  it.each([700, 320])('lays out the tests view, chips included, without horizontal page scroll at %i px', async (width) => {
    const { page } = await open(`${writeReport(`tests-narrow-${width}`, report)}#/tests`, { viewport: { width, height: 900 } });
    await page.locator('.tests-table .test-chips').first().waitFor();
    expect(await page.evaluate<boolean>("document.querySelector('.main').scrollWidth <= document.querySelector('.main').clientWidth")).toBe(true);
    expect(await page.evaluate<boolean>('document.documentElement.scrollWidth <= document.documentElement.clientWidth')).toBe(true);
    await page.close();
  });

  it('explains when the data cannot be read', async () => {
    const { page } = await open(writeReport('bad', { schemaVersion: 99 }));
    expect(await page.getByRole('alert').textContent()).toMatch(/Unsupported report schema version 99/);
    await page.close();
  });
});
