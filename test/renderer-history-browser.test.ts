import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect as expectLocator, type Browser, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RENDERER_SETTINGS, injectData, injectHistory, injectSettings } from '../src/core/inject.js';
import { NO_STATES_TEXT, STATE_HELP, STATE_LABEL, loadHistory, stateCount } from '../src/renderer/history.js';
import type { LoupeReport } from '../src/schema/v1.js';
import { HISTORY_STATES } from '../src/shared/history.js';
import { ROOT, assertBuilt } from './helpers/fixtures.js';
import { historyScenario, type HistoryScenario } from './helpers/history-scenarios.js';

/**
 * The history on the Overview and in the Tests view's filters, in the built
 * renderer (file://): without history no zone and no facet at all; with
 * history the change since the previous run or why there is none, the tests
 * by state linking to the filtered Tests view, the reason when no state is
 * shown, and the run-level notices. In the Tests view, a marker on the rows
 * of failing tests that have a state, and the definitions of the states.
 */

const RENDERER = path.join(ROOT, 'dist/renderer/index.html');
const SAMPLE = path.join(ROOT, 'src/renderer/dev/sample.json');

/** `placeholder`: a page whose history placeholder was never replaced (an older reporter). */
type Page_ = HistoryScenario | 'placeholder';
const PAGES: Page_[] = ['none', 'placeholder', 'normal', 'first-run', 'skipped', 'all-excluded', 'current-partial', 'version-break', 'skipped-some'];

describe('history on the Overview and in the filters (file://)', { timeout: 60_000 }, () => {
  let browser: Browser;
  let workDir: string;
  const sample = JSON.parse(readFileSync(SAMPLE, 'utf8')) as LoupeReport;
  const urls = {} as Record<Page_, string>;

  beforeAll(async () => {
    assertBuilt();
    workDir = mkdtempSync(path.join(tmpdir(), 'loupe-history-ui-'));
    const template = readFileSync(RENDERER, 'utf8');
    for (const name of PAGES) {
      const { report, history } = historyScenario(name === 'placeholder' ? 'none' : name, sample);
      const page = injectSettings(injectData(template, report), DEFAULT_RENDERER_SETTINGS);
      const file = path.join(workDir, `${name}.html`);
      writeFileSync(file, name === 'placeholder' ? page : injectHistory(page, history));
      urls[name] = pathToFileURL(file).href;
    }
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  async function open(name: Page_, hash: string): Promise<Page> {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(`${urls[name]}${hash}`);
    await page.locator('.main h1').first().waitFor();
    expect(errors).toEqual([]);
    return page;
  }

  const zone = (page: Page) => page.locator('[data-history]');

  it.each(['none', 'placeholder'] as const)('without history (%s): no history zone, no facet, a history= parameter dropped', async (name) => {
    const overview = await open(name, '#/');
    expect(await zone(overview).count()).toBe(0);
    expect(await overview.getByText(/History|New failure|Still failing|Fixed/).count()).toBe(0);
    await overview.close();
    const tests = await open(name, '#/tests?history=fixed&status=failed');
    expect(new URL(tests.url()).hash).toBe('#/tests?status=failed');
    expect(await tests.locator('[data-facet="history"]').count()).toBe(0);
    await tests.close();
  });

  it('a stream with earlier runs: the change since the previous full run, every state, each count linking to its tests', async () => {
    const { report, history } = historyScenario('normal', sample);
    const counts = loadHistory(JSON.stringify(history), report)?.analysis.counts;
    if (!counts) throw new Error('no history');
    const page = await open('normal', '#/');
    await expect.poll(() => zone(page).locator('.history-delta').innerText()).toMatch(/^Since the previous full run \(.+\): pass rate .+ · .+failed tests?$/);
    expect(await zone(page).locator('.history-state').allInnerTexts()).toEqual(HISTORY_STATES.map((state) => stateCount(state, counts[state])));
    const fixed = stateCount('fixed', counts.fixed);
    await page.getByRole('link', { name: fixed }).click();
    await page.locator('.view-tests').waitFor();
    expect(new URL(page.url()).hash).toBe('#/tests?history=fixed');
    expect(await page.locator('.result-count').innerText()).toMatch(new RegExp(`^${counts.fixed} of ${report.tests.length} tests`));
    expect(await page.locator('[data-facet="history"]').count()).toBe(1);
    await page.close();
  });

  it.each([
    ['first-run', 'first-run'],
    ['skipped', 'all-skipped'],
    ['all-excluded', 'all-excluded'],
  ] as const)('%s: one line instead of the states, no facet', async (name, reason) => {
    const page = await open(name, '#/');
    expect(await zone(page).locator('.history-note').allInnerTexts()).toEqual([NO_STATES_TEXT[reason]]);
    expect(await zone(page).locator('.history-states').count()).toBe(0);
    await page.close();
    const tests = await open(name, '#/tests?history=new-test');
    expect(new URL(tests.url()).hash).toBe('#/tests');
    expect(await tests.locator('[data-facet="history"]').count()).toBe(0);
    await tests.close();
  });

  it('a partial current run: why there is no delta, and the states', async () => {
    const page = await open('current-partial', '#/');
    expect(await zone(page).locator('.history-delta').count()).toBe(0);
    expect(await zone(page).locator('.history-note').first().innerText()).toBe('This run is partial: it is not compared with earlier runs.');
    expect(await zone(page).locator('.history-state').count()).toBe(HISTORY_STATES.length);
    await page.close();
  });

  it('run-level notices: the signature version break, the skipped files', async () => {
    const versions = await open('version-break', '#/');
    expect(await zone(versions).getByText(/^Loupe's error signatures changed: errors before .+ are not compared\.$/).count()).toBe(1);
    await versions.close();
    const skipped = await open('skipped-some', '#/');
    expect(await zone(skipped).getByText(/^3 earlier run files of this stream could not be read/).count()).toBe(1);
    expect(await zone(skipped).locator('.history-states').count()).toBe(1);
    await skipped.close();
  });

  describe('Tests view: the state marker', () => {
    it.each(['none', 'placeholder', 'first-run', 'skipped', 'all-excluded'] as const)('%s: no marker, no definitions', async (name) => {
      const page = await open(name, '#/tests');
      await page.locator('.tests-table').waitFor();
      expect([await page.locator('.history-marker').count(), await page.locator('.history-help').count()]).toEqual([0, 0]);
      await page.close();
    });

    it('on the rows of failing tests that have a state only, as many as the dashboard counts', async () => {
      const { report, history } = historyScenario('normal', sample);
      const loadedHistory = loadHistory(JSON.stringify(history), report);
      if (!loadedHistory) throw new Error('no history');
      const page = await open('normal', '#/tests');
      await page.locator('.tests-table').waitFor();
      const rows = page.locator('.tests-table tbody tr');
      expect(await rows.count()).toBe(report.tests.length);
      // Passing, flaky and skipped rows are unchanged, Fixed tests included.
      expect(await page.locator('tbody tr:not(:has(.outcome-failed)) .history-marker').count()).toBe(0);
      const shown = await page.locator('.history-marker').allInnerTexts();
      for (const state of ['new-failure', 'failed-again', 'still-failing', 'new-test'] as const) {
        expect(shown.filter((text) => text === STATE_LABEL[state]), state).toHaveLength(loadedHistory.analysis.counts[state]);
      }
      expect(shown).not.toContain(STATE_LABEL.fixed);
      await page.close();
    });

    it('its label is visible text, its icon hidden, its definition read on focus with the definitions closed', async () => {
      const page = await open('normal', '#/tests');
      const marker = page.locator('.history-marker', { hasText: STATE_LABEL['still-failing'] }).first();
      await expectLocator(marker).toHaveAccessibleName(STATE_LABEL['still-failing']);
      await expectLocator(marker).toHaveAccessibleDescription(`${STATE_HELP['still-failing']}.`);
      expect(await marker.locator('svg').getAttribute('aria-hidden')).toBe('true');
      expect(await page.locator('.history-help').getAttribute('open')).toBeNull();
      // The definitions open with the keyboard.
      await page.locator('.history-help summary').focus();
      await page.keyboard.press('Enter');
      await expectLocator(page.locator('.history-help dd').first()).toBeVisible();
      await page.close();
    });

    it('filters on its state, like a chip; active, it removes the filter', async () => {
      const page = await open('normal', '#/tests');
      await page.locator('.history-marker', { hasText: STATE_LABEL['failed-again'] }).first().click();
      await expectLocator(page).toHaveURL(/#\/tests\?history=failed-again$/);
      const active = page.locator('.history-marker.test-chip-active').first();
      await expectLocator(active).toHaveAccessibleName(`Remove filter History: ${STATE_LABEL['failed-again']}`);
      await active.click();
      await expectLocator(page).toHaveURL(/#\/tests$/);
      await page.close();
    });
  });
});
