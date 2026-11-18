import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect as expectLocator, type Browser, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RENDERER_SETTINGS, injectData, injectHistory, injectSettings } from '../src/core/inject.js';
import { parseNotes } from '../src/core/history/notes.js';
import { EXCLUDE_PLACEHOLDER, NO_RESULT_NOTE, NO_RETRIES_TEXT, ORIGIN_TEXT, STATE_HELP, noStatesText, notesInvalidText, whichRunsText, STATE_LABEL, countersText, loadHistory, stateCount, streamDefinition, streamName } from '../src/renderer/history.js';
import type { EmbeddedHistory } from '../src/schema/history-v1.js';
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

/**
 * `placeholder`: a page whose history placeholder was never replaced (an older reporter); `include-all`: `normal`
 * with `history.include: 'all'`; `notes-all`: `notes` with it.
 */
type Page_ = HistoryScenario | 'placeholder' | 'include-all' | 'notes-all' | 'notes-path' | 'absent-path' | 'notes-off' | 'unrecorded' | 'invalid-above' | 'all-excluded-above' | 'current-above' | 'tallest';
const PAGES: Page_[] = [
  'none',
  'placeholder',
  'normal',
  'first-run',
  'skipped',
  'all-excluded',
  'current-partial',
  'version-break',
  'skipped-some',
  'several-streams',
  'no-retries',
  'include-all',
  'notes',
  'notes-all',
  'notes-invalid',
  'notes-and-launch',
  'notes-current',
  'notes-path',
  'absent-path',
  'notes-off',
  'unrecorded',
  'invalid-above',
  'all-excluded-above',
  'current-above',
  'tallest',
];
/** A notes file in a folder above the Playwright config's, as the block names it. */
const ABOVE = '../shared/loupe.notes.json';
const BASE: Partial<Record<Page_, HistoryScenario>> = {
  placeholder: 'none',
  'include-all': 'normal',
  'notes-all': 'notes',
  'notes-path': 'notes',
  'absent-path': 'normal',
  'notes-off': 'normal',
  unrecorded: 'normal',
  'invalid-above': 'notes-invalid',
  'all-excluded-above': 'all-excluded',
  'current-above': 'notes-current',
  tallest: 'notes-and-launch',
};
/** Text of exactly `length` characters, of the line `line` repeated, ending with an ellipsis as a cut text does. */
const filled = (length: number, line: string) => `${line.repeat(Math.ceil(length / line.length)).slice(0, length - 1)}…`;
/** The tallest details a run can have: an extract of 300 characters on many lines, both reasons at 200, a note at 300. */
const TALLEST = {
  extract: filled(300, 'Error: expect(locator).toHaveText(expected) failed\n'),
  launch: filled(200, 'staging database restored during the run '),
  file: filled(200, 'Seed data missing after the restore '),
  note: filled(300, 'Restore took the whole afternoon '),
};
/**
 * How a page's block differs from its scenario's: `history.include: 'all'`; a custom `history.notes` (read, or
 * absent); `history.notes: false`; a run that is not recorded (no id).
 */
const VARIANT: Partial<Record<Page_, (block: EmbeddedHistory) => EmbeddedHistory>> = {
  'include-all': (block) => ({ ...block, include: 'all' }),
  'notes-all': (block) => ({ ...block, include: 'all' }),
  'notes-path': (block) => ({ ...block, notesPath: 'e2e/team-notes.json' }),
  'absent-path': (block) => ({ ...block, notesPath: 'e2e/loupe.notes.json' }),
  'notes-off': (block) => ({ ...block, notesFile: 'off', notesPath: null }),
  unrecorded: (block) => ({ ...block, current: { ...block.current, id: null } }),
  'invalid-above': (block) => ({ ...block, notesPath: ABOVE }),
  'all-excluded-above': (block) => ({ ...block, notesPath: ABOVE }),
  'current-above': (block) => ({ ...block, notesPath: ABOVE }),
  tallest: (block) => ({
    ...block,
    signatures: block.signatures.map(([signature, category, extract]) => [signature, category, extract === null ? null : TALLEST.extract]),
    runs: block.runs.map((run) => (run.notesExcluded === undefined ? run : { ...run, excluded: TALLEST.launch, notesExcluded: TALLEST.file, note: TALLEST.note })),
  }),
};

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
      const scenario = historyScenario(BASE[name] ?? (name as HistoryScenario), sample);
      const { report } = scenario;
      const variant = VARIANT[name];
      const history = variant && scenario.history ? variant(scenario.history) : scenario.history;
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

  describe('the configured notes file, named in every text', () => {
    const CUSTOM = 'e2e/team-notes.json';
    /** The default name left once the configured path is removed: none. */
    const noDefault = (text: string, notes: string) => expect(text.replaceAll(notes, '')).not.toContain('loupe.notes.json');

    it('the invalid-file notice names the file', async () => {
      const page = await open('invalid-above', '#/');
      const notice = (await zone(page).locator('.history-notice').allTextContents()).join(' ');
      expect(notice).toBe(`Note: ${ABOVE} could not be read: its entries are ignored (see the run output).`);
      noDefault(notice, ABOVE);
      await page.close();
    });

    it('the all-excluded line names the file', async () => {
      const page = await open('all-excluded-above', '#/');
      const note = (await zone(page).locator('.history-note').allInnerTexts()).join(' ');
      expect(note).toContain(`excluded (with LOUPE_EXCLUDE or in ${ABOVE})`);
      noDefault(note, ABOVE);
      await page.close();
    });

    it('the current run excluded by the file: its no-delta line and its cell name the file', async () => {
      const page = await open('current-above', '#/');
      const line = (await zone(page).locator('.history-note').allInnerTexts()).join(' ');
      expect(line).toContain(`, from ${ABOVE}): it is not compared with earlier runs.`);
      noDefault(line, ABOVE);
      await page.close();
    });

    it('a run excluded by the file and "Which runs are used": the selected run\'s details, and the help', async () => {
      const failingIndex = sample.tests.findIndex((test, index) => test.outcome === 'failed' && index % 4 === 0);
      const failing = sample.tests[failingIndex] as LoupeReport['tests'][number];
      const page = await open('notes-path', `#/test/${failing.id}${failing.repeatEachIndex > 0 ? `/repeat/${failing.repeatEachIndex}` : ''}`);
      const source = `(Staging was down (VPN), from ${CUSTOM})`;
      await page.locator('.strip-cell').nth(3).click();
      await expectLocator(page.locator('.run-selected-use')).toContainText(source);
      noDefault(await page.locator('.test-history').innerText(), CUSTOM);
      await page.close();
      for (const hash of ['#/', '#/tests']) {
        const help = await open('notes-path', hash);
        await expectLocator(help.locator('.history-help > p')).toHaveText(whichRunsText('full', CUSTOM));
        await expectLocator(help.locator('.history-help > p')).toContainText(`excluded (with LOUPE_EXCLUDE or in ${CUSTOM})`);
        await help.close();
      }
    });
  });

  describe('Run details: copy an exclusion for this run', () => {
    /** Records copied texts instead of the real clipboard; or no Clipboard API at all, for the fallback dialog. */
    const CLIPBOARD_STUB = `
      window.__copied = [];
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: (text) => { window.__copied.push(text); return Promise.resolve(); } },
      });
    `;
    const NO_CLIPBOARD = "Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });";
    const NAME = 'Copy exclusion for this run';

    async function overview(name: Page_, script = CLIPBOARD_STUB): Promise<Page> {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.addInitScript(script);
      await page.goto(`${urls[name]}#/`);
      await page.locator('.main h1').first().waitFor();
      return page;
    }
    async function copied(name: Page_): Promise<{ text: string; instruction: string }> {
      const page = await overview(name);
      await page.getByRole('button', { name: NAME }).click();
      await expect.poll(() => page.evaluate("window.__copied.length")).toBe(1);
      const text = await (page.evaluate("window.__copied[0]") as Promise<string>);
      const instruction = (await page.locator('.run-details-exclude span').last().textContent()) ?? '';
      await expectLocator(page.getByRole('status')).toContainText('Exclusion copied to the clipboard.');
      await page.close();
      return { text, instruction };
    }
    const mask = (text: string) => text;
    /** The current run's id, as the block says: never a run of the window. */
    const currentId = historyScenario('normal', sample).history?.current.id as string;

    it("no notes file: a whole minimal file, valid for Loupe's reader, with this run's id; saved next to the config", async () => {
      const { text, instruction } = await copied('normal');
      expect(text).toBe(`{\n  "notesVersion": 1,\n  "runs": [\n    { "run": "${currentId}", "exclude": "${EXCLUDE_PLACEHOLDER}" }\n  ]\n}\n`);
      expect(JSON.parse(text)).toEqual({ notesVersion: 1, runs: [{ run: currentId, exclude: EXCLUDE_PLACEHOLDER }] });
      const read = parseNotes(text, 'loupe.notes.json', mask);
      expect([read.status, read.problems, read.entries.map((entry) => entry.run)]).toEqual(['read', [], [currentId]]);
      expect(historyScenario('normal', sample).history?.runs.some((run) => run.id === currentId)).toBe(false);
      expect(instruction).toBe('Save it as loupe.notes.json next to the Playwright config and commit it: it applies from the next run.');
    });

    it('no notes file at a custom path with a folder: named relative to the config folder', async () => {
      const { instruction } = await copied('absent-path');
      expect(instruction).toBe("Save it as e2e/loupe.notes.json, relative to the Playwright config's folder, and commit it: it applies from the next run.");
    });

    it.each(['notes', 'notes-invalid'] as const)("a notes file (%s): one entry that pastes after \"runs\": [ into an empty or a non-empty array", async (name) => {
      const { text, instruction } = await copied(name);
      expect(text).toBe(`{ "run": "${currentId}", "exclude": "${EXCLUDE_PLACEHOLDER}" },`);
      expect(instruction).toBe('Paste it after "runs": [ in loupe.notes.json and commit it: it applies from the next run.');
      const paste = (file: string) => file.replace('"runs": [', `"runs": [${text}`);
      const empty = paste('{\n  "notesVersion": 1,\n  "runs": [\n  ]\n}\n');
      const filled = paste('{\n  "notesVersion": 1,\n  "runs": [\n    { "run": "dev-local-2", "note": "kept" }\n  ]\n}\n');
      for (const file of [empty, filled]) {
        const read = parseNotes(file, 'loupe.notes.json', mask);
        expect([read.status, read.problems], file).toEqual(['read', []]);
        expect(read.entries.find((entry) => entry.run === currentId)?.exclude, file).toBe(EXCLUDE_PLACEHOLDER);
      }
      expect(parseNotes(filled, 'loupe.notes.json', mask).entries.map((entry) => entry.run)).toEqual([currentId, 'dev-local-2']);
    });

    it('a custom history.notes path is the one named', async () => {
      const { instruction } = await copied('notes-path');
      expect(instruction).toBe('Paste it after "runs": [ in e2e/team-notes.json and commit it: it applies from the next run.');
    });

    it.each(['none', 'placeholder', 'notes-off', 'unrecorded'] as const)('no button (%s): no history, history.notes: false, or a run not recorded', async (name) => {
      const page = await overview(name);
      await page.getByRole('heading', { name: 'Run details' }).waitFor();
      expect(await page.getByRole('button', { name: NAME }).count()).toBe(0);
      expect(await page.locator('.run-details-exclude').count()).toBe(0);
      await page.close();
    });

    it('without the Clipboard API: the fallback dialog shows the text to copy by hand', async () => {
      const page = await overview('notes', NO_CLIPBOARD);
      await page.getByRole('button', { name: NAME }).click();
      const dialog = page.locator('dialog.copy-dialog[open]');
      await expectLocator(dialog).toHaveCount(1);
      await expectLocator(dialog.getByRole('heading')).toHaveText('Copy exclusion');
      await expectLocator(dialog.locator('textarea')).toHaveValue(`{ "run": "${currentId}", "exclude": "${EXCLUDE_PLACEHOLDER}" },`);
      await page.close();
    });
  });

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
        await expectLocator(page.locator('.history-help > p')).toHaveText(whichRunsText(include, 'loupe.notes.json'));
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
    expect(await zone(page).locator('.history-note').allInnerTexts()).toEqual([noStatesText(reason, 'loupe.notes.json')]);
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

  it('loupe.notes.json: one note in the verdict for an invalid file only, nothing for one read, none without history', async () => {
    const invalid = await open('notes-invalid', '#/');
    expect(await zone(invalid).locator('.history-notice').allTextContents()).toEqual([`Note: ${notesInvalidText('loupe.notes.json')}`]);
    // Its entries are ignored: the stream reads as the normal one.
    expect(await zone(invalid).locator('.history-delta').count()).toBe(1);
    await invalid.close();
    for (const name of ['notes', 'notes-and-launch', 'normal'] as const) {
      const page = await open(name, '#/');
      expect(await zone(page).locator('.history-notice').count(), name).toBe(0);
      expect(await zone(page).innerText(), name).not.toContain('loupe.notes.json');
      await page.close();
    }
    for (const name of ['none', 'placeholder'] as const) {
      const page = await open(name, '#/');
      expect(await page.locator('body').innerText(), name).not.toMatch(/loupe\.notes\.json|Excluded run|Note: /);
      await page.close();
    }
  });

  it('the current run excluded by loupe.notes.json: no delta, the reason with its source', async () => {
    const page = await open('notes-current', '#/');
    expect(await zone(page).locator('.history-delta').count()).toBe(0);
    expect(await zone(page).locator('.history-note').first().innerText()).toBe('This run is excluded (Merge job run again on stale blobs, from loupe.notes.json): it is not compared with earlier runs.');
    await page.close();
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
        whichRunsText('full', 'loupe.notes.json'),
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
      // Set apart by CSS: the separator is no element.
      expect(await cells(page).last().evaluate((element) => element.ownerDocument.defaultView!.getComputedStyle(element, '::before').borderLeftStyle)).toBe('solid');
      expect(await page.locator('.test-history a').count()).toBe(0);
      await page.close();
    });

    const region = (page: Page) => page.locator('.run-selected');
    const listbox = (page: Page) => page.getByRole('listbox', { name: 'Runs of this test: select one to see its details' });
    const focusedCell = (page: Page) => page.evaluate<string | null>("document.activeElement?.getAttribute('data-cell') ?? null");
    const activeTag = (page: Page) => page.evaluate<string>("document.activeElement?.tagName ?? ''");
    const regionText = async (page: Page) => (await region(page).innerText()).replace(/\s+/g, ' ');
    /** Selects a run as a pointer does: a click, focus on its cell. */
    const select = async (page: Page, index: number) => {
      await cells(page).nth(index).click();
      await expectLocator(region(page)).toHaveAttribute('data-run-id', (await cells(page).nth(index).getAttribute('data-run-id')) ?? '');
    };
    const ESCAPED = /[()[\]]/g;
    /** Whether a name holds any of these texts: reasons and notes never are in one. */
    const names = (page: Page) => cells(page).evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-label') ?? ''));

    it('a listbox of options with short names, nothing else in it; one option selected at most, none at first', async () => {
      const page = await open('normal', testHash(failing));
      await expectLocator(listbox(page)).toHaveCount(1);
      await expectLocator(listbox(page)).toHaveAttribute('aria-orientation', 'horizontal');
      const children = await listbox(page).evaluate((element) => [...element.children].map((child) => child.getAttribute('role')));
      expect(new Set(children)).toEqual(new Set(['option']));
      expect(await page.getByRole('option').count()).toBe(await cells(page).count());
      expect(await page.locator('[role="option"][aria-selected="true"]').count()).toBe(0);
      expect(await page.locator('.strip-cell[aria-describedby]').count()).toBe(0);
      await expectLocator(region(page)).toHaveCount(0);
      // The last option is the current run, its name saying so.
      await expectLocator(cells(page).last()).toHaveAccessibleName(/^This run: /);
      await page.close();
    });

    it('an excluded run is drawn hollow, a partial or IDE run flagged; names say "excluded" or "partial", the details say how the run is used', async () => {
      const page = await open('normal', testHash(failing));
      for (const [index, use, flagged, word] of [
        [9, "Excluded run (staging database restored during the run): not used in this test's history", false, ', excluded'],
        [5, "Partial run (grep): used in this test's history, not in run comparisons", true, ', partial'],
        [13, "Run from the IDE: used in this test's history, not in run comparisons", true, ''],
      ] as const) {
        const cell = cells(page).nth(index);
        const classes = (await cell.getAttribute('class')) ?? '';
        expect(classes.includes('strip-flagged'), String(index)).toBe(flagged);
        expect(classes.includes('strip-excluded'), String(index)).toBe(!flagged);
        const name = (await cell.getAttribute('aria-label')) ?? '';
        expect(name.endsWith(word === '' ? name.slice(-1) : word), name).toBe(true);
        expect(name).not.toMatch(/used|restored|grep|\(/);
        await select(page, index);
        await expectLocator(region(page).locator('.run-selected-use')).toHaveText(use);
      }
      if (!((await cells(page).nth(13).getAttribute('aria-label')) ?? '').includes(', IDE, ')) throw new Error('run 13 is not from the IDE');
      // Nothing about use for an ordinary run.
      await select(page, 0);
      expect(await region(page).locator('.run-selected-use').count()).toBe(0);
      expect(await page.locator('.strip-excluded').count()).toBe(1);
      expect(await page.locator('.strip-flagged').count()).toBe(2);
      await page.close();
    });

    it('a run excluded by loupe.notes.json: drawn hollow, its name says "excluded" only; the details give the reason with its source and the note, as text', async () => {
      const page = await open('notes', testHash(failing));
      const excluded = cells(page).nth(3);
      expect(await excluded.getAttribute('class')).toContain('strip-excluded');
      expect(await excluded.getAttribute('aria-label')).toMatch(/, excluded$/);
      await select(page, 3);
      await expectLocator(region(page).locator('.run-selected-use')).toHaveText("Excluded run (Staging was down (VPN), from loupe.notes.json): not used in this test's history");
      await expectLocator(region(page).locator('.run-selected-note')).toHaveText('Note: Ops restarted the gateway at 14:10; rerun is dev-local-4');
      // A note alone: the run counts, its name says nothing more, its details give the note.
      const annotated = cells(page).nth(7);
      expect(await annotated.getAttribute('class')).not.toContain('strip-excluded');
      await select(page, 7);
      await expectLocator(region(page).locator('.run-selected-note')).toHaveText('Note: First run after the auth refactor');
      // Markup in a note is text: shown as written, no element made from it.
      await select(page, 15);
      await expectLocator(region(page).locator('.run-selected-note')).toHaveText('Note: <b>Checkout</b> flag on & retries at 2: <script>alert(1)</script> stays text');
      expect(await page.locator('.test-history b, .test-history script').count()).toBe(0);
      // The launch exclusion of run 9 keeps its wording.
      await select(page, 9);
      await expectLocator(region(page).locator('.run-selected-use')).toHaveText("Excluded run (staging database restored during the run): not used in this test's history");
      // No name holds a reason or a note.
      for (const name of await names(page)) expect(name).not.toMatch(/VPN|staging|gateway|refactor|Checkout|Note|used|loupe\.notes/);
      expect(await page.locator('.strip-excluded').count()).toBe(2);
      await page.close();
    });

    it("with include: 'all', a run excluded by loupe.notes.json is used, and its details say so", async () => {
      const page = await open('notes-all', testHash(failing));
      expect(await cells(page).nth(3).getAttribute('class')).not.toContain('strip-excluded');
      expect(await page.locator('.strip-excluded').count()).toBe(0);
      await select(page, 3);
      await expectLocator(region(page).locator('.run-selected-use')).toHaveText("Excluded run (Staging was down (VPN), from loupe.notes.json): used, because history.include is 'all'");
      await page.close();
    });

    it('a run excluded both ways with a note: both reasons, each with its source, and the note', async () => {
      const page = await open('notes-and-launch', testHash(failing));
      await select(page, 9);
      await expectLocator(region(page).locator('.run-selected-use')).toHaveText(
        "Excluded run (staging database restored during the run, at launch; Seed data missing after the restore, from loupe.notes.json): not used in this test's history",
      );
      await expectLocator(region(page).locator('.run-selected-note')).toHaveText('Note: Restore took the whole afternoon');
      expect(await cells(page).nth(9).getAttribute('aria-label')).toMatch(/, excluded$/);
      await page.close();
    });

    it('the current run, excluded by loupe.notes.json: drawn excluded; its details are this run, with the reason, the note and where its errors are', async () => {
      const page = await open('notes-current', testHash(failing));
      const current = cells(page).last();
      const classes = (await current.getAttribute('class')) ?? '';
      expect([classes.includes('strip-current'), classes.includes('strip-excluded')]).toEqual([true, true]);
      expect(await current.getAttribute('aria-label')).toMatch(/^This run: .*, excluded$/);
      await select(page, (await cells(page).count()) - 1);
      await expectLocator(region(page).getByRole('heading', { level: 3 })).toHaveText(/^Selected run, .+ \(this run\)$/);
      await expectLocator(region(page).locator('.run-selected-use')).toHaveText("Excluded run (Merge job run again on stale blobs, from loupe.notes.json): not used in this test's history");
      await expectLocator(region(page).locator('.run-selected-note')).toHaveText('Note: See the next run');
      await expectLocator(region(page)).toContainText('Its errors are in the attempts below.');
      expect(await region(page).locator('.run-selected-extract').count()).toBe(0);
      await page.close();
    });

    it('keyboard: one tab stop, arrows and Home / End between options, never out of the strip; moving selects nothing and changes nothing', async () => {
      const page = await open('normal', testHash(failing));
      const count = await cells(page).count();
      expect(await page.locator('.strip-cell[tabindex="0"]').count()).toBe(1);
      await cells(page).last().focus();
      const layout = await page.locator('.test-history').boundingBox();
      await page.keyboard.press('ArrowRight');
      expect(await focusedCell(page)).toBe(String(count - 1));
      await page.keyboard.press('ArrowLeft');
      expect(await focusedCell(page)).toBe(String(count - 2));
      await page.keyboard.press('Home');
      expect(await focusedCell(page)).toBe('0');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowUp');
      expect(await focusedCell(page)).toBe('0');
      expect(await page.locator('.strip-cell[tabindex="0"]').getAttribute('data-cell')).toBe('0');
      await page.keyboard.press('End');
      expect(await focusedCell(page)).toBe(String(count - 1));
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowDown');
      expect(await focusedCell(page)).toBe(String(count - 1));
      // Nothing was selected, nothing opened, nothing moved.
      expect(await page.locator('[role="option"][aria-selected="true"]').count()).toBe(0);
      await expectLocator(region(page)).toHaveCount(0);
      expect(await page.locator('.test-history').boundingBox()).toEqual(layout);
      // Tab leaves the strip in one press.
      await cells(page).first().focus();
      await page.keyboard.press('Tab');
      expect(await focusedCell(page)).toBeNull();
      expect(await activeTag(page)).not.toBe('BODY');
      await page.close();
    });

    it.each(['Enter', ' '] as const)('%j selects the focused run and opens its details; focus stays on its option; again closes them', async (key) => {
      const page = await open('normal', testHash(failing));
      await cells(page).nth(4).focus();
      await page.keyboard.press(key);
      await expectLocator(region(page)).toHaveAttribute('data-run-id', (await cells(page).nth(4).getAttribute('data-run-id')) ?? '');
      await expectLocator(cells(page).nth(4)).toHaveAttribute('aria-selected', 'true');
      expect(await page.locator('[role="option"][aria-selected="true"]').count()).toBe(1);
      expect(await focusedCell(page)).toBe('4');
      // Another run: moving to it changes nothing, choosing it shows it.
      await page.keyboard.press('ArrowRight');
      await expectLocator(region(page)).toHaveAttribute('data-run-id', (await cells(page).nth(4).getAttribute('data-run-id')) ?? '');
      await page.keyboard.press(key);
      await expectLocator(region(page)).toHaveAttribute('data-run-id', (await cells(page).nth(5).getAttribute('data-run-id')) ?? '');
      await page.keyboard.press(key);
      await expectLocator(region(page)).toHaveCount(0);
      expect(await page.locator('[role="option"][aria-selected="true"]').count()).toBe(0);
      expect(await focusedCell(page)).toBe('5');
      await page.close();
    });

    it('a click or a tap selects; the selected run again, Close or Escape closes, focus back on its option', async () => {
      const page = await open('normal', testHash(failing));
      await cells(page).nth(3).click();
      await expectLocator(region(page)).toBeVisible();
      expect(await focusedCell(page)).toBe('3');
      await cells(page).nth(3).click();
      await expectLocator(region(page)).toHaveCount(0);
      // Close: focus back on the selected option.
      await select(page, 6);
      await region(page).getByRole('button', { name: 'Close the selected run' }).click();
      await expectLocator(region(page)).toHaveCount(0);
      expect(await focusedCell(page)).toBe('6');
      // Escape inside the details.
      await select(page, 2);
      await region(page).getByRole('button', { name: 'Close the selected run' }).focus();
      await page.keyboard.press('Escape');
      await expectLocator(region(page)).toHaveCount(0);
      expect(await focusedCell(page)).toBe('2');
      await page.close();
      const context = await browser.newContext({ viewport: { width: 400, height: 800 }, hasTouch: true });
      const touch = await context.newPage();
      await touch.goto(`${urls.normal}${testHash(failing)}`);
      await cells(touch).nth(3).tap();
      await expectLocator(region(touch)).toHaveAttribute('data-run-id', (await cells(touch).nth(3).getAttribute('data-run-id')) ?? '');
      // A tap elsewhere changes nothing: the details stay until closed.
      await touch.locator('.test-title').tap();
      await expectLocator(region(touch)).toBeVisible();
      await context.close();
    });

    it('nothing opens on hover; a hint says what to do while no run is selected', async () => {
      const page = await open('normal', testHash(failing));
      for (const index of [0, 3, 9]) await cells(page).nth(index).hover();
      await page.waitForTimeout(300);
      await expectLocator(region(page)).toHaveCount(0);
      expect(await page.locator('[role="option"][aria-selected="true"]').count()).toBe(0);
      expect(await cells(page).first().evaluate((element) => element.ownerDocument.defaultView!.getComputedStyle(element).cursor)).toBe('pointer');
      const hint = page.locator('.strip-hint');
      await expectLocator(hint).toHaveText('Select a run to see its details.');
      await expectLocator(hint).toHaveAttribute('aria-hidden', 'true');
      // Beside the strip on a wide screen.
      const strip = await listbox(page).boundingBox();
      const box = await hint.boundingBox();
      if (!strip || !box) throw new Error('no box');
      expect(box.x).toBeGreaterThan(strip.x + strip.width - 0.5);
      expect(box.y).toBeLessThan(strip.y + strip.height);
      await select(page, 3);
      await expectLocator(hint).toHaveCount(0);
      await page.close();
      // Under it in a narrow layout.
      const narrow = await browser.newPage({ viewport: { width: 320, height: 800 } });
      await narrow.goto(`${urls.normal}${testHash(failing)}`);
      const s = await listbox(narrow).boundingBox();
      const h = await narrow.locator('.strip-hint').boundingBox();
      if (!s || !h) throw new Error('no box');
      expect(h.y).toBeGreaterThanOrEqual(s.y + s.height - 0.5);
      await narrow.close();
    });

    it('the selected option keeps a ring of its own, apart from the focus outline, in both themes and in forced colours', async () => {
      for (const [scheme, forced] of [
        ['light', false],
        ['dark', false],
        ['light', true],
      ] as const) {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: scheme });
        if (forced) await page.emulateMedia({ forcedColors: 'active' });
        await page.goto(`${urls.normal}${testHash(failing)}`);
        await select(page, 3);
        // Focus elsewhere: the ring stays; another option focused shows its outline, not a ring.
        await page.keyboard.press('ArrowRight');
        const style = (index: number) =>
          cells(page)
            .nth(index)
            .evaluate((element) => {
              const css = element.ownerDocument.defaultView!.getComputedStyle(element);
              return { width: css.borderTopWidth, color: css.borderTopColor, radius: css.borderTopLeftRadius, outline: css.outlineStyle };
            });
        const selectedStyle = await style(3);
        const focusedStyle = await style(4);
        const plain = await style(2);
        expect(selectedStyle.width, scheme).toBe('2px');
        expect(selectedStyle.radius, scheme).toBe('50%');
        expect(selectedStyle.color).not.toBe(plain.color);
        expect(selectedStyle.color).not.toMatch(/rgba\(0, 0, 0, 0\)/);
        expect(focusedStyle.width).toBe('1px');
        expect(focusedStyle.outline).toBe('solid');
        expect(selectedStyle.outline).toBe('none');
        await page.close();
      }
    });

    it('the details of a failed run: a heading, the facts, the extract whole and the run id', async () => {
      const { report, history } = historyScenario('normal', sample);
      const loadedHistory = loadHistory(JSON.stringify(history), report);
      const index = loadedHistory?.index;
      if (!history || !index) throw new Error('no history');
      const strip = testCells(history, index, failingIndex);
      const column = strip.findIndex((cell) => cell.code === 'F' && cell.failure?.extract);
      const cell = strip[column] as (typeof strip)[number];
      const page = await open('normal', testHash(failing));
      const element = cells(page).nth(column);
      await expectLocator(element).toHaveAccessibleName(new RegExp(`, ${ORIGIN_TEXT[cell.run.origin]}, failed, ${cell.failure?.category}$`));
      await select(page, column);
      const date = ((await element.getAttribute('aria-label')) ?? '').split(`, ${ORIGIN_TEXT[cell.run.origin]}, `)[0];
      await expectLocator(region(page).getByRole('heading', { level: 3 })).toHaveText(`Selected run, ${date}`);
      await expectLocator(page.getByRole('region', { name: `Selected run, ${date}` })).toHaveCount(1);
      const facts = await region(page).locator('.run-selected-facts li').allTextContents();
      expect(facts[0]).toBe('Result: failed');
      expect(facts).toEqual(expect.arrayContaining([`Origin: ${ORIGIN_TEXT[cell.run.origin]}`, `Category: ${cell.failure?.category}`]));
      expect(facts.some((fact) => fact.startsWith('Run duration: '))).toBe(true);
      expect(facts.at(-1)).toBe(`Category: ${cell.failure?.category}`);
      await expectLocator(region(page).locator('.run-selected-extract')).toHaveText((cell.failure?.extract ?? '').trim());
      await expectLocator(region(page)).toHaveAttribute('data-run-id', cell.run.id);
      await page.close();
    });

    it.each([1280, 320])('the tallest details at %ipx: every text whole, the extract without scroll or maximum height', async (width) => {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(`${urls.tallest}${testHash(failing)}`);
      await select(page, 9);
      const text = await regionText(page);
      for (const part of [TALLEST.launch, TALLEST.file, TALLEST.note]) expect(text).toContain(part.replace(/\s+/g, ' ').trim());
      const failed = (await cells(page).evaluateAll((elements) => elements.map((element) => element.className))).findIndex((name) => name.includes('strip-F') && !name.includes('strip-current'));
      await select(page, failed);
      const extract = region(page).locator('.run-selected-extract');
      await expectLocator(extract).toHaveText(TALLEST.extract.trim());
      const box = await extract.evaluate((element) => {
        const css = element.ownerDocument.defaultView!.getComputedStyle(element);
        return { scroll: element.scrollHeight, client: element.clientHeight, max: css.maxHeight, overflow: css.overflowY };
      });
      expect(box.max).toBe('none');
      expect(box.overflow).toBe('visible');
      expect(box.scroll).toBeLessThanOrEqual(box.client + 1);
      expect(box.client).toBeGreaterThan(96);
      // Within the page's width: nothing wider than the main area.
      const main = await page.locator('main').boundingBox();
      const r = await region(page).boundingBox();
      if (!main || !r) throw new Error('no box');
      expect(r.x + r.width).toBeLessThanOrEqual(main.x + main.width + 0.5);
      await page.close();
    });

    it('a failure of another signature version says why its error is not shown', async () => {
      const { history } = historyScenario('version-break', sample);
      if (!history) throw new Error('no history');
      const width = history.runs.length;
      const column = history.runs.findIndex((run, index) => !run.sameSignatures && history.cells[failingIndex * width + index] === 'F');
      expect(column).toBeGreaterThanOrEqual(0);
      const page = await open('version-break', testHash(failing));
      await select(page, column);
      await expectLocator(region(page)).toContainText("Error not compared: this run was recorded with another version of Loupe's error signatures.");
      expect(await region(page).locator('.run-selected-extract').count()).toBe(0);
      await page.close();
    });

    it('Tab from the strip enters the details on Close, which comes after the heading and before the facts, never losing focus to the page', async () => {
      const page = await open('tallest', testHash(failing));
      await select(page, 1);
      await page.keyboard.press('Tab');
      await expectLocator(region(page).getByRole('button', { name: 'Close the selected run' })).toBeFocused();
      // In the DOM: the heading, Close, then the facts, the extract.
      const order = await region(page).evaluate((section) =>
        ['h3', '.run-selected-actions button', '.run-selected-facts', '.run-selected-extract'].map((selector) => {
          const element = section.querySelector(selector);
          return element ? [...section.querySelectorAll('*')].indexOf(element) : -1;
        }),
      );
      expect(order.every((position) => position >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      await expectLocator(region(page)).toBeVisible();
      // And back: Shift+Tab returns to the strip's one tab stop, the details still open.
      await page.keyboard.press('Shift+Tab');
      expect(await focusedCell(page)).toBe('1');
      await expectLocator(region(page)).toBeVisible();
      await page.close();
    });

    it.each([
      [1280, 'beside'],
      [320, 'under'],
    ] as const)('at %ipx, Close is %s the heading', async (width, placement) => {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(`${urls.normal}${testHash(failing)}`);
      await select(page, 1);
      const heading = await region(page).getByRole('heading', { level: 3 }).boundingBox();
      const close = await region(page).getByRole('button', { name: 'Close the selected run' }).boundingBox();
      const facts = await region(page).locator('.run-selected-facts').boundingBox();
      const box = await region(page).boundingBox();
      if (!heading || !close || !facts || !box) throw new Error('no box');
      expect(close.y + close.height).toBeLessThanOrEqual(facts.y + 0.5);
      if (placement === 'beside') {
        // At the top right of the details.
        expect(close.x).toBeGreaterThan(heading.x + heading.width);
        expect(close.y).toBeLessThan(heading.y + heading.height);
        expect(box.x + box.width - (close.x + close.width)).toBeLessThan(24);
      } else {
        expect(close.y).toBeGreaterThanOrEqual(heading.y + heading.height - 0.5);
      }
      await page.close();
    });

    it('closed by default; once open, the details push what follows down, in the page flow', async () => {
      const page = await open('normal', testHash(failing));
      await expectLocator(region(page)).toHaveCount(0);
      const below = page.locator('.history-counters');
      const before = await below.boundingBox();
      await select(page, 3);
      const after = await below.boundingBox();
      const details = await region(page).boundingBox();
      if (!before || !after || !details) throw new Error('no box');
      expect(after.y).toBeGreaterThan(before.y + details.height - 1);
      expect(await region(page).evaluate((element) => element.ownerDocument.defaultView!.getComputedStyle(element).position)).toBe('static');
      await page.close();
    });

    describe('Escape: the details close only from inside them, never under the drawer or a dialog', () => {
      const NO_CLIPBOARD = "Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });";
      async function withDetails(options: { width?: number; init?: string } = {}): Promise<{ page: Page; close: () => Promise<void> }> {
        const context = await browser.newContext({ viewport: { width: options.width ?? 1280, height: 900 } });
        if (options.init) await context.addInitScript({ content: options.init });
        const page = await context.newPage();
        await page.goto(`${urls.normal}${testHash(failing)}`);
        await select(page, 3);
        return { page, close: () => context.close() };
      }

      it('on an option: Escape closes the details, focus staying on that option; with none open, it does nothing', async () => {
        const { page, close } = await withDetails();
        // Focus moved to another option: Escape closes, focus stays there.
        await page.keyboard.press('ArrowRight');
        expect(await focusedCell(page)).toBe('4');
        await page.keyboard.press('Escape');
        await expectLocator(region(page)).toHaveCount(0);
        expect(await page.locator('[role="option"][aria-selected="true"]').count()).toBe(0);
        expect(await focusedCell(page)).toBe('4');
        // None open: nothing happens, nothing opens.
        await page.keyboard.press('Escape');
        await expectLocator(region(page)).toHaveCount(0);
        expect(await focusedCell(page)).toBe('4');
        await close();
      });

      /** Escape as it would reach an option while something covers the page: the strip must leave it alone. */
      const escapeOnOption = (page: Page) => cells(page).nth(3).dispatchEvent('keydown', { key: 'Escape', bubbles: true });
      /**
       * Reading the details in browse mode or with caret browsing (F7): focus rests on `main`, the caret (the
       * selection's anchor) in the details. Firefox and Chromium both deliver Escape to the page then, its target
       * `main` (checked with caret browsing on, in both).
       */
      const readDetails = (page: Page) =>
        page.evaluate(`(() => {
          document.querySelector('main').focus();
          const text = document.querySelector('.run-selected .run-selected-facts li').firstChild;
          document.getSelection().collapse(text, 3);
        })()`);

      it('while reading the details (focus on main, the caret in them): Escape closes them and focuses the selected option', async () => {
        const { page, close } = await withDetails();
        await readDetails(page);
        expect(await activeTag(page)).toBe('MAIN');
        await page.keyboard.press('Escape');
        await expectLocator(region(page)).toHaveCount(0);
        expect(await focusedCell(page)).toBe('3');
        await close();
      });

      it('a caret left in the details with focus on a control elsewhere: Escape leaves them open', async () => {
        const { page, close } = await withDetails();
        await readDetails(page);
        await page.getByRole('button', { name: 'Copy rerun command for this test' }).focus();
        await page.keyboard.press('Escape');
        await expectLocator(region(page)).toBeVisible();
        await close();
      });

      it('never cancels the key: listeners after it see Escape unhandled', async () => {
        const { page, close } = await withDetails();
        await page.evaluate("window.__escape = null; window.addEventListener('keydown', (event) => { if (event.key === 'Escape') window.__escape = event.defaultPrevented; })");
        await readDetails(page);
        await page.keyboard.press('Escape');
        await expectLocator(region(page)).toHaveCount(0);
        expect(await page.evaluate('window.__escape')).toBe(false);
        await close();
      });

      it('on an option or with the caret in the details, under the narrow drawer or a dialog: Escape leaves the details open', async () => {
        const narrow = await withDetails({ width: 400 });
        await readDetails(narrow.page);
        await narrow.page.locator('#sidebar-toggle').click();
        await expectLocator(narrow.page.locator('#sidebar')).toBeVisible();
        await escapeOnOption(narrow.page);
        await narrow.page.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
        await expectLocator(region(narrow.page)).toBeVisible();
        await narrow.close();
        const dialog = await withDetails({ init: NO_CLIPBOARD });
        await dialog.page.getByRole('button', { name: 'Copy rerun command for this test' }).click();
        await expectLocator(dialog.page.locator('dialog.copy-dialog[open]')).toHaveCount(1);
        await escapeOnOption(dialog.page);
        await dialog.page.evaluate(`(() => {
          document.getSelection().collapse(document.querySelector('.run-selected .run-selected-facts li').firstChild, 3);
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        })()`);
        await expectLocator(region(dialog.page)).toBeVisible();
        await dialog.close();
      });

      it('focus outside the details: Escape leaves them open', async () => {
        const { page, close } = await withDetails();
        await page.locator('.test-title').click();
        await page.keyboard.press('Escape');
        await expectLocator(region(page)).toBeVisible();
        await close();
      });

      it('the narrow drawer: Escape closes it, focus back on its toggle; the details under it stay', async () => {
        const { page, close } = await withDetails({ width: 400 });
        const toggle = page.locator('#sidebar-toggle');
        await toggle.focus();
        await page.keyboard.press('Enter');
        await expectLocator(page.locator('#sidebar')).toBeVisible();
        await page.keyboard.press('Escape');
        await expectLocator(page.locator('#sidebar')).toBeHidden();
        await expectLocator(toggle).toBeFocused();
        await expectLocator(region(page)).toBeVisible();
        await close();
      });

      it('the copy fallback dialog: Escape closes it; the details under it stay', async () => {
        const { page, close } = await withDetails({ init: NO_CLIPBOARD });
        const button = page.getByRole('button', { name: 'Copy rerun command for this test' });
        await button.focus();
        await page.keyboard.press('Enter');
        await expectLocator(page.locator('dialog.copy-dialog[open]')).toHaveCount(1);
        await page.keyboard.press('Escape');
        await expectLocator(page.locator('dialog.copy-dialog[open]')).toHaveCount(0);
        await expectLocator(button).toBeFocused();
        await expectLocator(region(page)).toBeVisible();
        await close();
      });
    });

    it.each([
      ['fr-FR', /octobre/, /\boct\./],
      ['en-US', /October/, /\bOct\b/],
    ] as const)('%s: the month written out in every option name and in the heading of the details', async (locale, long, short) => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale, timezoneId: 'Europe/Paris' });
      await page.goto(`${urls.normal}${testHash(failing)}`);
      await cells(page).first().waitFor();
      const all = await names(page);
      // The sample's runs are in October.
      for (const name of all) {
        expect(name).toMatch(long);
        expect(name).not.toMatch(short);
      }
      await select(page, 1);
      const heading = (await region(page).getByRole('heading', { level: 3 }).textContent()) ?? '';
      expect(heading).toMatch(long);
      expect(heading).not.toMatch(short);
      await expectLocator(page.getByRole('region', { name: heading })).toHaveCount(1);
      // The rest of the report keeps its short dates: the header's run start.
      await expectLocator(page.locator('.header time').first()).toHaveText(short);
      await page.close();
    });

    describe("the test's history state in the header", () => {
      const { report: normalReport, history: normalHistory } = historyScenario('normal', sample);
      const loaded = loadHistory(JSON.stringify(normalHistory), normalReport);
      /** The first test of the sample with this outcome and state in the normal scenario. */
      const withState = (outcome: string, state: string | null) => {
        const index = normalReport.tests.findIndex((test) => test.outcome === outcome && (loaded?.byTest.get(test)?.state ?? null) === state);
        if (index < 0) throw new Error(`no ${outcome} test with state ${state}`);
        return sample.tests[index] as LoupeReport['tests'][number];
      };
      const link = (page: Page) => page.locator('.test-header .test-state-link');

      it.each(['new-test', 'new-failure', 'still-failing', 'failed-again'] as const)('%s: right after the status, the Tests view marker\'s chip, a link named and described as the marker', async (state) => {
        const test = withState('failed', state);
        const page = await open('normal', testHash(test));
        await expectLocator(link(page)).toHaveCount(1);
        await expectLocator(link(page)).toHaveAccessibleName(STATE_LABEL[state]);
        await expectLocator(link(page)).toHaveAccessibleDescription(STATE_HELP[state]);
        await expectLocator(link(page)).toHaveAttribute('title', STATE_HELP[state]);
        await expectLocator(page.getByRole('link', { name: STATE_LABEL[state], exact: true })).toHaveCount(1);
        // Right after the status, no separator. As shown (innerText: the hidden definition is not part of it).
        expect(await page.locator('.test-header .test-outcome').innerText()).toMatch(new RegExp(`^Failed\\s*${STATE_LABEL[state]}$`));
        await expectLocator(link(page)).toHaveClass(new RegExp(`\\btest-chip\\b.*\\bstate-${state}\\b`));
        // The same state leads the History section.
        await expectLocator(page.locator('.history-test-state-label')).toHaveText(STATE_LABEL[state]);
        await page.close();
      });

      it('activating it, by click or by keyboard, moves focus to the History heading; the route does not change', async () => {
        const test = withState('failed', 'still-failing');
        const page = await open('normal', testHash(test));
        const url = page.url();
        await link(page).click();
        await expectLocator(page.getByRole('heading', { level: 2, name: /^History/ })).toBeFocused();
        expect(page.url()).toBe(url);
        await page.locator('.test-title').click();
        await link(page).focus();
        await page.keyboard.press('Enter');
        await expectLocator(page.getByRole('heading', { level: 2, name: /^History/ })).toBeFocused();
        expect(page.url()).toBe(url);
        await page.close();
      });

      it.each([
        ['a passing test (Fixed)', 'normal', () => withState('passed', 'fixed')],
        ['a passing test without a state', 'normal', () => withState('passed', null)],
        ['no states shown (every earlier run excluded)', 'all-excluded', () => failing],
        ['no states shown (first run)', 'first-run', () => failing],
        ['without history', 'none', () => failing],
      ] as const)('nothing for %s', async (_, name, test) => {
        const page = await open(name, testHash(test()));
        await page.locator('.test-summary').waitFor();
        await expectLocator(link(page)).toHaveCount(0);
        await expectLocator(page.locator('#test-state-help')).toHaveCount(0);
        await page.close();
      });

      /** What the chip looks like, as computed: compared with the Tests view's marker of the same state. */
      const chipStyle = (locator: ReturnType<Page['locator']>) =>
        locator.evaluate((element) => {
          const css = element.ownerDocument.defaultView!.getComputedStyle(element);
          return {
            border: `${css.borderTopWidth} ${css.borderTopStyle} ${css.borderTopColor}`,
            radius: css.borderTopLeftRadius,
            background: css.backgroundColor,
            color: css.color,
            font: `${css.fontSize}/${css.lineHeight} ${css.fontWeight}`,
            padding: `${css.paddingLeft} ${css.paddingRight}`,
            decoration: css.textDecorationLine,
            icon: element.querySelector('svg')?.outerHTML ?? '',
          };
        });

      it.each([
        ['light', false],
        ['dark', false],
        ['light', true],
      ] as const)('%s theme (forced colours: %s): the same chip as the Tests view marker, underlined and outlined only on hover or focus', async (scheme, forced) => {
        const test = withState('failed', 'still-failing');
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: scheme });
        if (forced) await page.emulateMedia({ forcedColors: 'active' });
        await page.goto(`${urls.normal}#/tests`);
        const marker = page.locator('.history-marker.state-still-failing:not(.test-chip-active)').first();
        await marker.waitFor();
        const expected = await chipStyle(marker);
        await page.goto(`${urls.normal}${testHash(test)}`);
        await link(page).waitFor();
        const header = await chipStyle(link(page));
        expect(header).toEqual(expected);
        expect(header.decoration).toBe('none');
        // Not the category badge's blue: the chip's own colours (forced colours make both system colours).
        const badge = await page.locator('.test-summary .category-badge').evaluate((element) => {
          const css = element.ownerDocument.defaultView!.getComputedStyle(element);
          return { color: css.color, background: css.backgroundColor };
        });
        if (!forced) expect([header.color, header.background]).not.toEqual([badge.color, badge.background]);
        // Focus by keyboard: an outline and the underline.
        await page.locator('.test-title').click();
        await page.keyboard.press('Tab');
        for (let step = 0; step < 10 && !(await link(page).evaluate((element) => element === element.ownerDocument.activeElement)); step += 1) await page.keyboard.press('Tab');
        const focused = await link(page).evaluate((element) => {
          const css = element.ownerDocument.defaultView!.getComputedStyle(element);
          return { outline: css.outlineStyle, width: parseFloat(css.outlineWidth), decoration: css.textDecorationLine };
        });
        expect(focused).toEqual({ outline: 'solid', width: 2, decoration: 'underline' });
        // Hover: the underline.
        await page.locator('.test-title').click();
        await link(page).hover();
        expect(await link(page).evaluate((element) => element.ownerDocument.defaultView!.getComputedStyle(element).textDecorationLine)).toBe('underline');
        await page.close();
      });

      it('in the History section, the state is the lead line: larger and bold, in the text colour, the explanation after it', async () => {
        const page = await open('normal', testHash(withState('failed', 'still-failing')));
        const style = await page.locator('.history-test-state-label').evaluate((element) => {
          const view = element.ownerDocument.defaultView!;
          const label = view.getComputedStyle(element);
          const line = view.getComputedStyle(element.parentElement!);
          return { size: parseFloat(label.fontSize), weight: Number(label.fontWeight), color: label.color, text: line.color, lineSize: parseFloat(line.fontSize) };
        });
        expect(style.size).toBeGreaterThan(style.lineSize);
        expect(style.weight).toBeGreaterThanOrEqual(700);
        expect(style.color).toBe(style.text);
        await expectLocator(page.locator('.history-test-state')).toContainText('it failed in its last earlier result too');
        await page.close();
      });
    });

    it('another test: no run selected', async () => {
      const page = await open('normal', testHash(failing));
      await select(page, 3);
      const other = sample.tests.find((test, index) => index !== failingIndex && test.outcome === 'failed') as LoupeReport['tests'][number];
      await page.evaluate(`location.hash = ${JSON.stringify(testHash(other))}`);
      await expectLocator(page.locator('.test-title')).toContainText(other.title);
      await expectLocator(region(page)).toHaveCount(0);
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
