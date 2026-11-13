import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect as expectLocator, type Browser, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RENDERER_SETTINGS, injectData, injectHistory, injectSettings } from '../src/core/inject.js';
import { NO_RESULT_NOTE, NO_RETRIES_TEXT, NO_STATES_TEXT, ORIGIN_TEXT, WHICH_RUNS_TEXT, STATE_HELP, STATE_LABEL, countersText, loadHistory, stateCount, streamDefinition, streamName } from '../src/renderer/history.js';
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

/** `placeholder`: a page whose history placeholder was never replaced (an older reporter); `include-all`: `normal` with `history.include: 'all'`. */
type Page_ = HistoryScenario | 'placeholder' | 'include-all';
const PAGES: Page_[] = ['none', 'placeholder', 'normal', 'first-run', 'skipped', 'all-excluded', 'current-partial', 'version-break', 'skipped-some', 'several-streams', 'no-retries', 'include-all'];

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
      const scenario = historyScenario(name === 'placeholder' ? 'none' : name === 'include-all' ? 'normal' : name, sample);
      const { report } = scenario;
      const history = name === 'include-all' && scenario.history ? { ...scenario.history, include: 'all' as const } : scenario.history;
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

  async function open(name: Page_, hash: string, colorScheme: 'light' | 'dark' = 'light'): Promise<Page> {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme });
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

  it('the Overview holds one closed "What the history states mean"; each count link is described by its definition', async () => {
    const { report, history } = historyScenario('normal', sample);
    const counts = loadHistory(JSON.stringify(history), report)?.analysis.counts;
    if (!counts) throw new Error('no history');
    const page = await open('normal', '#/');
    const help = page.locator('.history-help');
    expect(await help.count()).toBe(1);
    expect(await help.getAttribute('open')).toBeNull();
    const linked = HISTORY_STATES.filter((state) => counts[state] > 0);
    expect(linked.length).toBeGreaterThan(1);
    for (const state of linked) {
      const link = zone(page).getByRole('link', { name: stateCount(state, counts[state]) });
      // Read on focus while the definitions are closed; the title stays for the mouse.
      await expectLocator(link).toHaveAccessibleDescription(`${STATE_HELP[state]}.`);
      expect(await link.locator('xpath=..').getAttribute('title')).toBe(STATE_HELP[state]);
    }
    // Opened with the keyboard: the definitions, then which runs are used, under a heading one level below the zone's.
    await help.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expectLocator(help.locator('dd').first()).toBeVisible();
    await expectLocator(help.getByRole('heading', { name: 'Which runs are used', level: 4 })).toBeVisible();
    await page.close();
  });

  it("which runs are used follows history.include, on the Overview and in the Tests view", async () => {
    for (const [name, include] of [
      ['normal', 'full'],
      ['include-all', 'all'],
    ] as const) {
      for (const hash of ['#/', '#/tests']) {
        const page = await open(name, hash);
        await expectLocator(page.locator('.history-help > p')).toHaveText(WHICH_RUNS_TEXT[include]);
        await page.close();
      }
    }
    // The verdict's own wording already follows it.
    const all = await open('include-all', '#/');
    await expect.poll(() => zone(all).locator('.history-delta').innerText()).toMatch(/^Since the previous run \(/);
    await all.close();
  });

  it.each([
    ['first-run', 'first-run'],
    ['skipped', 'all-skipped'],
    ['all-excluded', 'all-excluded'],
  ] as const)('%s: one line instead of the states, no facet', async (name, reason) => {
    const page = await open(name, '#/');
    expect(await zone(page).locator('.history-note').allInnerTexts()).toEqual([NO_STATES_TEXT[reason]]);
    expect(await zone(page).locator('.history-states').count()).toBe(0);
    expect(await page.locator('.history-help').count()).toBe(0);
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

  it('run-level notices: the signature version break, the skipped files, each a note with its text alternative', async () => {
    const versions = await open('version-break', '#/');
    expect(await zone(versions).locator('.history-notice').allTextContents()).toEqual([expect.stringMatching(/^Note: Loupe's error signatures changed: errors before .+ are not compared\.$/)]);
    await versions.close();
    const skipped = await open('skipped-some', '#/');
    expect(await zone(skipped).locator('.history-notice').allTextContents()).toEqual([expect.stringMatching(/^Note: 3 earlier run files of this stream could not be read/)]);
    expect(await zone(skipped).locator('.history-states').count()).toBe(1);
    // The icon is hidden: "Note:" is its text alternative.
    expect(await zone(skipped).locator('.history-notice svg').getAttribute('aria-hidden')).toBe('true');
    await skipped.close();
    // No notice without a reason for one.
    const normal = await open('normal', '#/');
    expect(await zone(normal).locator('.history-notice').count()).toBe(0);
    await normal.close();
  });

  it.each(['light', 'dark'] as const)('run-level notices in the %s theme: contrast met, styled as a note, not as an error', async (colorScheme) => {
    const page = await open('version-break', '#/', colorScheme);
    await page.locator('.history-notice').waitFor();
    // Colours as the page computes them: the note's text, icon and background, and the failure and warning colours.
    const colours = await page.evaluate<Record<string, string>>(`(() => {
      const notice = document.querySelector('.history-notice');
      const probe = (property) => {
        const element = document.createElement('span');
        element.style.color = 'var(' + property + ')';
        document.body.append(element);
        const value = getComputedStyle(element).color;
        element.remove();
        return value;
      };
      return {
        text: getComputedStyle(notice).color,
        icon: getComputedStyle(notice.querySelector('svg')).color,
        background: getComputedStyle(notice).backgroundColor,
        failed: probe('--status-failed'),
        flaky: probe('--status-flaky'),
        flakyBackground: probe('--status-flaky-bg'),
      };
    })()`);
    const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const luminance = (value: string) => {
      const [r, g, b] = rgb(value).map((channel) => {
        const c = channel / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
    };
    const contrast = (a: string, b: string) => {
      const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
    };
    // Text at least 4.5:1 (WCAG 1.4.3), the icon at least 3:1 (1.4.11).
    expect(contrast(colours.text ?? '', colours.background ?? '')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colours.icon ?? '', colours.background ?? '')).toBeGreaterThanOrEqual(3);
    // A background of its own, not the failure or warning colours.
    expect(colours.background).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    for (const colour of [colours.text, colours.icon, colours.background]) expect([colours.failed, colours.flaky, colours.flakyBackground]).not.toContain(colour);
    await page.close();
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
      // Which runs each level uses, in words.
      await expectLocator(page.locator('.history-help > p')).toHaveText(
        WHICH_RUNS_TEXT.full,
      );
      await page.close();
    });

    it('the facet: each value is described by its definition, from the one list of the view', async () => {
      const { report, history } = historyScenario('normal', sample);
      const counts = loadHistory(JSON.stringify(history), report)?.analysis.counts;
      if (!counts) throw new Error('no history');
      const page = await open('normal', '#/tests');
      expect(await page.locator('.history-help').count()).toBe(1);
      await expectLocator(page.locator('.history-help').getByRole('heading', { name: 'Which runs are used', level: 2, includeHidden: true })).toHaveCount(1);
      const facet = page.locator('[data-facet="history"]');
      await facet.locator('summary').focus();
      await page.keyboard.press('Enter');
      const boxes = facet.getByRole('checkbox');
      const present = HISTORY_STATES.filter((state) => counts[state] > 0);
      expect(await boxes.count()).toBe(present.length);
      for (const [index, state] of present.entries()) {
        await expectLocator(boxes.nth(index)).toHaveAccessibleName(new RegExp(`^${STATE_LABEL[state]}`));
        await expectLocator(boxes.nth(index)).toHaveAccessibleDescription(`${STATE_HELP[state]}.`);
      }
      await page.close();
    });

    it('every state icon is its own shape, and none draws an arc: curved arrows are flaky\'s sign', async () => {
      const page = await open('normal', '#/tests');
      // The definitions hold every state's icon, also while closed.
      const shapes = await page.locator('.history-help dt').evaluateAll((terms) =>
        terms.map((term) => [term.textContent?.trim(), [...term.querySelectorAll('path')].map((path) => path.getAttribute('d')).join(' ')]),
      );
      expect(shapes.map(([label]) => label)).toEqual(HISTORY_STATES.map((state) => STATE_LABEL[state]));
      expect(new Set(shapes.map(([, d]) => d)).size).toBe(HISTORY_STATES.length);
      for (const [label, d] of shapes) expect(d, label).not.toMatch(/[Aa]/);
      // The rule means something: flaky's status icon is drawn with arcs (the strip's flaky mark too, ResultGlyph).
      const flaky = await page.locator('.outcome-flaky path').first().getAttribute('d');
      expect(flaky).toMatch(/A/);
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

    it('an excluded run is drawn hollow, not used; a partial or ide run, used in the test history, gets a flag only; the same words everywhere', async () => {
      const page = await open('normal', testHash(failing));
      const excluded = cells(page).nth(9);
      expect(await excluded.getAttribute('class')).toContain('strip-excluded');
      const excludedUse = "Excluded run (staging database restored during the run): not used in this test's history";
      for (const [index, use, flagged] of [
        [9, excludedUse, false],
        [5, "Partial run (grep): used in this test's history, not in run comparisons", true],
        [13, "Run from the IDE: used in this test's history, not in run comparisons", true],
      ] as const) {
        const cell = cells(page).nth(index);
        const classes = (await cell.getAttribute('class')) ?? '';
        expect(classes.includes('strip-flagged'), String(index)).toBe(flagged);
        expect(classes.includes('strip-excluded'), String(index)).toBe(!flagged);
        // The name ends with the sentence, the description and the panel give it whole.
        expect(await cell.getAttribute('aria-label')).toMatch(new RegExp(`, ${(use.charAt(0).toLowerCase() + use.slice(1)).replace(/[()]/g, '\\$&')}$`));
        await expectLocator(cell).toHaveAccessibleDescription(new RegExp(use.replace(/[()]/g, '\\$&')));
        await cell.hover();
        await expectLocator(page.locator('.strip-facts')).toContainText(use);
      }
      // No "Counting" field, and nothing about use for an ordinary run.
      const ordinary = cells(page).nth(0);
      await ordinary.hover();
      await expectLocator(page.locator('.strip-facts')).not.toContainText(/Counting|used in|not used/);
      expect(await page.locator('.test-history').innerText()).not.toMatch(/Counting/);
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
      await expectLocator(element).toHaveAccessibleName(new RegExp(`, ${ORIGIN_TEXT[cell.run.origin]}, failed, ${cell.failure?.category}`));
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
      await expectLocator(page.locator('.history-counters')).toHaveText(countersText(facts.counters, true));
      await page.close();
    });

    it('the retry counter only when the stream had retries; without, the no-retries line says why', async () => {
      for (const [name, retries] of [
        ['no-retries', false],
        ['several-streams', true],
      ] as const) {
        const { report, history } = historyScenario(name, sample);
        const facts = loadHistory(JSON.stringify(history), report)?.byTest.get(report.tests[failingIndex] as never);
        if (!facts) throw new Error('no history');
        expect(facts.noRetries, name).toBe(!retries);
        const page = await open(name, testHash(failing));
        const counters = page.locator('.history-counters');
        await expectLocator(counters).toHaveText(countersText(facts.counters, retries));
        expect((await counters.innerText()).includes('passed on retry'), name).toBe(retries);
        await page.locator('.history-more > summary').focus();
        await page.keyboard.press('Enter');
        await expectLocator(page.getByText(NO_RETRIES_TEXT)).toHaveCount(retries ? 0 : 1);
        await page.close();
      }
    });

    it('compact: no cell details until a cell is hovered or focused; they float, moving nothing', async () => {
      const page = await open('normal', testHash(failing));
      const details = page.locator('.strip-details');
      expect(await details.count()).toBe(0);
      const below = page.locator('.history-counters');
      const before = await below.boundingBox();
      await cells(page).nth(3).hover();
      await expectLocator(details).toBeVisible();
      expect(await below.boundingBox()).toEqual(before);
      await page.mouse.move(0, 0);
      await expectLocator(details).toHaveCount(0);
      // Focus shows them too, also for the current run; leaving the strip hides them.
      await cells(page).last().focus();
      await expectLocator(details).toBeVisible();
      await page.keyboard.press('Tab');
      await expectLocator(details).toHaveCount(0);
      await page.close();
    });

    it('compact: the rest in a disclosure, closed, whose summary is the counters line', async () => {
      const { report, history } = historyScenario('several-streams', sample);
      const facts = loadHistory(JSON.stringify(history), report)?.byTest.get(report.tests[failingIndex] as never);
      if (!facts) throw new Error('no history');
      const page = await open('several-streams', testHash(failing));
      const more = page.locator('details.history-more');
      expect(await more.getAttribute('open')).toBeNull();
      await expectLocator(more.locator('> summary')).toHaveText(countersText(facts.counters, true));
      await expectLocator(page.locator('.history-other').first()).toBeHidden();
      await more.locator('> summary').focus();
      await page.keyboard.press('Enter');
      await expectLocator(page.locator('.history-other').first()).toBeVisible();
      await page.close();
    });

    it('compact: counters alone are a plain line; without counters the summary names the other streams; nothing inside, no disclosure', async () => {
      // normal: counters, retries in the stream, no other stream.
      const normal = await open('normal', testHash(failing));
      expect([await normal.locator('details.history-more').count(), await normal.locator('p.history-counters').count()]).toEqual([0, 1]);
      await normal.close();
      // first-run: no strip, no counters, two other streams.
      const first = await open('first-run', testHash(failing));
      await expectLocator(first.locator('details.history-more > summary')).toHaveText('Latest result in other streams');
      expect(await first.locator('details.history-more').getAttribute('open')).toBeNull();
      await first.close();
      // all-excluded: no counters, no other stream.
      const excluded = await open('all-excluded', testHash(failing));
      expect([await excluded.locator('details.history-more').count(), await excluded.locator('.history-counters').count()]).toEqual([0, 0]);
      await excluded.close();
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
      // Inside the closed disclosure: opened with the keyboard.
      await expectLocator(page.getByText(NO_RESULT_NOTE)).toBeHidden();
      await page.locator('.history-more > summary').focus();
      await page.keyboard.press('Enter');
      await expectLocator(page.getByText(NO_RESULT_NOTE)).toBeVisible();
      // Streams in words, and what a stream is.
      await expectLocator(page.locator('.history-other-stream')).toHaveText((history?.others ?? []).map((other) => streamName(other.stream)));
      await expectLocator(page.locator('.history-other-stream').first()).toHaveText('staging, CI');
      await expectLocator(page.getByText(streamDefinition(history?.stream ?? {}))).toBeVisible();
      const texts = await items.allInnerTexts();
      codes.forEach((code, index) => {
        const text = (texts[index] ?? '').replace(/\s+/g, ' ');
        if (code === '-') {
          expect(text).toMatch(/No result\*?$/);
          expect(text).not.toMatch(/passed/);
        }
      });
      await page.close();
    });
  });
});
