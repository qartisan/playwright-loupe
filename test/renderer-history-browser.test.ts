import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect as expectLocator, type Browser, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RENDERER_SETTINGS, injectData, injectHistory, injectSettings } from '../src/core/inject.js';
import { NO_RESULT_NOTE, NO_STATES_TEXT, STATE_HELP, STATE_LABEL, countersText, loadHistory, stateCount } from '../src/renderer/history.js';
import type { LoupeReport } from '../src/schema/v1.js';
import { HISTORY_STATES, testCells } from '../src/shared/history.js';
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
const PAGES: Page_[] = ['none', 'placeholder', 'normal', 'first-run', 'skipped', 'all-excluded', 'current-partial', 'version-break', 'skipped-some', 'several-streams'];

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

    it.each([
      ['wide', 1280],
      ['narrow', 400],
    ] as const)('%s: on the line of the chips, the row no taller than one without a marker', async (_label, width) => {
      const page = await open('normal', '#/tests');
      await page.setViewportSize({ width, height: 900 });
      const rows = await page.locator('.tests-table tbody').evaluate((body) =>
        [...body.querySelectorAll('tr')].map((row) => {
          const top = row.getBoundingClientRect().top;
          const offset = (selector: string) => {
            const element = row.querySelector(selector);
            return element ? element.getBoundingClientRect().top - top : null;
          };
          const title = row.querySelector('.cell-title > a');
          return { marker: offset('.history-marker'), chips: offset('.test-chips'), oneLine: (title?.getClientRects().length ?? 0) === 1, height: row.getBoundingClientRect().height };
        }),
      );
      const both = rows.filter((row) => row.marker !== null && row.chips !== null && row.oneLine);
      expect(both.length).toBeGreaterThan(0);
      for (const row of both) expect(Math.abs((row.marker as number) - (row.chips as number))).toBeLessThan(0.5);
      // A one-line title with chips: the same height with a marker as without.
      const without = rows.find((row) => row.marker === null && row.chips !== null && row.oneLine);
      expect(Math.abs((both[0]?.height ?? 0) - (without?.height ?? 0))).toBeLessThan(0.5);
      await page.close();
    });
  });

  describe('test detail: the history of a test', () => {
    /** A failing test of the sample whose strip has a partial run (5), an excluded run (9) and an ide run (13), every run with a result. */
    const failingIndex = sample.tests.findIndex((test, index) => test.outcome === 'failed' && index % 4 === 0);
    const failing = sample.tests[failingIndex] as LoupeReport['tests'][number];
    const testHash = (test: LoupeReport['tests'][number]) => `#/test/${test.id}${test.repeatEachIndex > 0 ? `/repeat/${test.repeatEachIndex}` : ''}`;
    const cells = (page: Page) => page.locator('.strip-cell');

    it.each(['none', 'placeholder', 'skipped'] as const)('%s: no history section (nothing to show)', async (name) => {
      const page = await open(name, testHash(failing));
      await page.locator('.test-header').waitFor();
      expect(await page.locator('.test-history').count()).toBe(0);
      await page.close();
    });

    it('one cell per run of the window, oldest first, then this run set apart, the run id kept on each cell', async () => {
      const { history } = historyScenario('normal', sample);
      const page = await open('normal', testHash(failing));
      expect(await cells(page).count()).toBe((history?.runs.length ?? 0) + 1);
      const ids = await cells(page).evaluateAll((elements) => elements.map((element) => element.getAttribute('data-run-id')));
      expect(ids.slice(0, -1)).toEqual(history?.runs.map((run) => run.id));
      expect(await cells(page).last().getAttribute('class')).toContain('strip-current');
      expect(await page.locator('.strip-gap').count()).toBe(1);
      expect(await page.locator('.test-history a').count()).toBe(0);
      await page.close();
    });

    it('an excluded run is drawn hollow, as not counted; a partial or ide run that counts gets a flag only', async () => {
      const page = await open('normal', testHash(failing));
      const excluded = cells(page).nth(9);
      expect(await excluded.getAttribute('class')).toContain('strip-excluded');
      await expectLocator(excluded).toHaveAccessibleName(/, not counted: run excluded \(staging database restored during the run\)$/);
      for (const [index, note] of [
        [5, 'partial run (grep)'],
        [13, 'run from the IDE'],
      ] as const) {
        const cell = cells(page).nth(index);
        const classes = (await cell.getAttribute('class')) ?? '';
        expect(classes).toContain('strip-flagged');
        expect(classes).not.toContain('strip-excluded');
        await expectLocator(cell).toHaveAccessibleName(new RegExp(`, ${note.replace(/[()]/g, '\\$&')}$`));
      }
      // Every other run counts and is full: neither hollow nor flagged.
      expect(await page.locator('.strip-excluded').count()).toBe(1);
      expect(await page.locator('.strip-flagged').count()).toBe(2);
      await page.close();
    });

    it('keyboard: one tab stop, arrows and Home / End between cells, never out of the strip', async () => {
      const page = await open('normal', testHash(failing));
      const count = await cells(page).count();
      expect(await page.locator('.strip-cell[tabindex="0"]').count()).toBe(1);
      await cells(page).last().focus();
      const focused = () => page.evaluate<string | null>("document.activeElement?.getAttribute('data-cell') ?? null");
      // The last cell: Right and End stay on it.
      await page.keyboard.press('ArrowRight');
      expect(await focused()).toBe(String(count - 1));
      await page.keyboard.press('ArrowLeft');
      expect(await focused()).toBe(String(count - 2));
      await page.keyboard.press('Home');
      expect(await focused()).toBe('0');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowUp');
      expect(await focused()).toBe('0');
      // Still the one tab stop of the strip: Tab comes back to it.
      expect(await page.locator('.strip-cell[tabindex="0"]').getAttribute('data-cell')).toBe('0');
      await page.keyboard.press('End');
      expect(await focused()).toBe(String(count - 1));
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowDown');
      expect(await focused()).toBe(String(count - 1));
      expect(await page.locator('.strip-cell[tabindex="0"]').getAttribute('data-cell')).toBe(String(count - 1));
      // Tab leaves the strip in one press.
      await cells(page).first().focus();
      await page.keyboard.press('Tab');
      expect(await focused()).toBeNull();
      await page.close();
    });

    it('a cell names its date, origin, result and category, and gives its facts on focus; the panel follows focus', async () => {
      const { report, history } = historyScenario('normal', sample);
      const loadedHistory = loadHistory(JSON.stringify(history), report);
      const index = loadedHistory?.index;
      if (!history || !index) throw new Error('no history');
      const strip = testCells(history, index, failingIndex);
      const column = strip.findIndex((cell) => cell.code === 'F' && cell.failure?.extract);
      const cell = strip[column] as (typeof strip)[number];
      const page = await open('normal', testHash(failing));
      const element = cells(page).nth(column);
      await expectLocator(element).toHaveAccessibleName(new RegExp(`, ${cell.run.origin}, failed, ${cell.failure?.category}`));
      await element.focus();
      await expectLocator(element).toHaveAccessibleDescription(/Run duration: .+/);
      await expectLocator(page.locator('.strip-details')).toHaveAttribute('data-run-id', cell.run.id);
      await expectLocator(page.locator('.strip-extract')).toHaveText((cell.failure?.extract ?? '').trim());
      await page.close();
    });

    it('a failure of another signature version says why its error is not shown', async () => {
      const { history } = historyScenario('version-break', sample);
      if (!history) throw new Error('no history');
      const width = history.runs.length;
      const column = history.runs.findIndex((run, index) => !run.sameSignatures && history.cells[failingIndex * width + index] === 'F');
      expect(column).toBeGreaterThanOrEqual(0);
      const page = await open('version-break', testHash(failing));
      await cells(page).nth(column).focus();
      await expectLocator(page.locator('.strip-details')).toContainText("Error not compared: this run was recorded with another version of Loupe's error signatures.");
      expect(await page.locator('.strip-extract').count()).toBe(0);
      await page.close();
    });

    it('the state with its N, the counters as facts, no score', async () => {
      const { report, history } = historyScenario('normal', sample);
      const facts = loadHistory(JSON.stringify(history), report)?.byTest.get(report.tests[failingIndex] as never);
      if (!facts?.state) throw new Error('no state');
      const page = await open('normal', testHash(failing));
      await expectLocator(page.locator('.history-test-state')).toContainText(STATE_LABEL[facts.state]);
      await expectLocator(page.locator('.history-counters')).toHaveText(countersText(facts.counters));
      await page.close();
    });

    it('no state shown (every earlier run excluded): the strip, hollow, without state or counters', async () => {
      const page = await open('all-excluded', testHash(failing));
      expect(await page.locator('.strip-excluded').count()).toBe(await cells(page).count() - 1);
      expect([await page.locator('.history-test-state').count(), await page.locator('.history-counters').count()]).toEqual([0, 0]);
      await page.close();
    });

    it('first run of the stream: no strip, the other streams', async () => {
      const page = await open('first-run', testHash(failing));
      expect(await cells(page).count()).toBe(0);
      expect(await page.locator('.history-other').count()).toBe(2);
      await page.close();
    });

    it('other streams: stream, date and result; a missing result is "No result", never passed, with its limit as visible text', async () => {
      const { history } = historyScenario('several-streams', sample);
      // The production stream leaves out every third test of the sample.
      const missing = sample.tests[0] as LoupeReport['tests'][number];
      const page = await open('several-streams', testHash(missing));
      const items = page.locator('.history-other');
      expect(await items.count()).toBe(history?.others.length);
      const codes = history?.others.map((other) => other.cells[0]) ?? [];
      expect(codes).toContain('-');
      const texts = await items.allInnerTexts();
      codes.forEach((code, index) => {
        const text = (texts[index] ?? '').replace(/\s+/g, ' ');
        if (code === '-') {
          expect(text).toMatch(/No result\*?$/);
          expect(text).not.toMatch(/passed/);
        }
      });
      await expectLocator(page.getByText(NO_RESULT_NOTE)).toBeVisible();
      await page.close();
    });
  });
});
