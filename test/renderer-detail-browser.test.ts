import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RENDERER_SETTINGS, injectData, injectSettings, type RendererSettings } from '../src/core/inject.js';
import { errorGroups, rankGroups } from '../src/renderer/dashboard.js';
import { rerunCommand } from '../src/renderer/detail/rerun.js';
import type { LoupeReport, TestCase } from '../src/schema/v1.js';
import { ROOT, assertBuilt, isMissingAttachmentFile } from './helpers/fixtures.js';

/**
 * The test detail, the error group navigation, the copy buttons and the
 * keyboard shortcuts, in the built renderer opened from file:// with the
 * renderer sample (a real run of the fixture suite). Role and ARIA
 * assertions stand for the accessibility checks.
 */

const RENDERER = path.join(ROOT, 'dist/renderer/index.html');
const SAMPLE = path.join(ROOT, 'src/renderer/dev/sample.json');

/** Records copied texts instead of the real clipboard. */
const CLIPBOARD_STUB = `
  window.__copied = [];
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: (text) => { window.__copied.push(text); return Promise.resolve(); } },
  });
`;
/** A browser without the Clipboard API (some restrict it on file://). */
const NO_CLIPBOARD = "Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });";
/** A browser that refuses the Clipboard API. */
const CLIPBOARD_REFUSED = `
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: () => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError')) },
  });
`;
/** Records every text the app's live region takes, in order, in `window.__announced`. */
const ANNOUNCEMENTS = `
  window.__announced = [];
  window.__region = '';
  new MutationObserver(() => {
    const region = document.querySelector('.app > [role="status"]');
    if (region && region.textContent !== window.__region) window.__announced.push((window.__region = region.textContent));
  }).observe(document, { subtree: true, childList: true, characterData: true });
`;

describe('test detail in a browser (file://)', { timeout: 30_000 }, () => {
  let browser: Browser;
  let workDir: string;
  let report: LoupeReport;
  let url: string;

  function find(title: string, project = 'chromium-a'): TestCase {
    const test = report.tests.find((candidate) => candidate.title === title && candidate.project === project);
    if (!test) throw new Error(`no test "${title}" in ${project}`);
    return test;
  }

  function writeReport(name: string, data: unknown, settings: RendererSettings = DEFAULT_RENDERER_SETTINGS): string {
    const file = path.join(workDir, `${name}.html`);
    writeFileSync(file, injectSettings(injectData(readFileSync(RENDERER, 'utf8'), data), settings));
    return pathToFileURL(file).href;
  }

  async function open(hash: string, options: { init?: string; colorScheme?: 'light' | 'dark'; reportUrl?: string } = {}): Promise<{ page: Page; errors: string[] }> {
    const context = await browser.newContext({ colorScheme: options.colorScheme ?? 'light', viewport: { width: 1400, height: 900 } });
    if (options.init) await context.addInitScript({ content: options.init });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      // The sample's attachment files are not next to this temporary report: its videos and images fail to load.
      if (message.type() === 'error' && !isMissingAttachmentFile(message, page)) errors.push(message.text());
    });
    await page.goto(`${options.reportUrl ?? url}${hash}`);
    return { page, errors };
  }

  const hashOf = (page: Page): string => decodeURIComponent(new URL(page.url()).hash);
  const testHash = (test: TestCase): string => `#/test/${test.id}`;

  beforeAll(async () => {
    assertBuilt();
    workDir = mkdtempSync(path.join(tmpdir(), 'loupe-detail-'));
    report = JSON.parse(readFileSync(SAMPLE, 'utf8')) as LoupeReport;
    url = writeReport('sample', report);
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it('opens a flaky test on its failing attempt, and ?attempt= on that exact attempt', async () => {
    const flaky = find('is flaky: fails on the first attempt, passes on retry (intentional)');
    const { page, errors } = await open(testHash(flaky));
    const tabs = page.getByRole('tablist', { name: 'Attempts' }).getByRole('tab');
    await expect.poll(() => tabs.count()).toBe(2);
    expect(await tabs.allTextContents()).toEqual([expect.stringMatching(/^Attempt 1, Failed/), expect.stringMatching(/^Retry 1, Passed/)]);
    expect(await page.getByRole('tab', { selected: true }).textContent()).toMatch(/^Attempt 1/);
    expect(await page.getByRole('tabpanel').getByRole('heading', { name: 'Error' }).count()).toBe(1);
    // Each attempt keeps its own attachments.
    expect(await page.getByRole('tabpanel').locator('.attachment-name').allTextContents()).toContain('attempt');

    await page.getByRole('tab', { name: /Retry 1/ }).click();
    await expect.poll(() => hashOf(page)).toBe(`${testHash(flaky)}?attempt=1`);
    expect(await page.getByRole('tabpanel').getByRole('heading', { name: 'Error' }).count()).toBe(0);
    // Arrow keys move between tabs, like any tab list.
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => hashOf(page)).toBe(`${testHash(flaky)}?attempt=0`);
    expect(await page.evaluate<string | null>('document.activeElement?.getAttribute("data-attempt")')).toBe('0');

    // `[` and `]` are no shortcut (removed: AltGr on AZERTY keyboards).
    await page.locator('body').focus();
    await page.keyboard.press(']');
    await page.keyboard.press('[');
    await page.evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    expect(hashOf(page)).toBe(`${testHash(flaky)}?attempt=0`);

    await page.goto(`${url}${testHash(flaky)}?attempt=1`);
    await expect.poll(() => page.getByRole('tab', { selected: true }).textContent()).toMatch(/^Retry 1/);
    // An attempt the test does not have: the default attempt, URL normalized.
    await page.goto(`${url}${testHash(flaky)}?status=flaky&attempt=7`);
    await expect.poll(() => hashOf(page)).toBe(`${testHash(flaky)}?status=flaky`);
    expect(await page.getByRole('tab', { selected: true }).textContent()).toMatch(/^Attempt 1/);
    expect(errors).toEqual([]);
    await page.close();
  });

  it.each(['light', 'dark'] as const)('shows errors with Expected / Received, the snippet arrow, the stack collapsed, in the %s theme', async (colorScheme) => {
    const failing = find('fails on a wrong heading (intentional)');
    const { page, errors } = await open(testHash(failing), { colorScheme });
    const card = page.locator('.error-card').first();
    await card.waitFor();
    expect(await card.locator('.error-message .tone-expected').allTextContents()).toEqual(['"Wrong heading"']);
    expect(await card.locator('.error-message .tone-received').allTextContents()).toEqual(['"Loupe fixture"']);
    // The call log stays plain.
    expect(await card.locator('.error-message').textContent()).toContain('Call log:');
    expect(await card.locator('.code-snippet .tone-marker').allTextContents()).toEqual(['>', '^']);
    expect(await card.locator('.error-location').textContent()).toMatch(/^basics\.spec\.ts:\d+:\d+$/);
    const stack = card.locator('details.stack-details');
    expect(await stack.getAttribute('open')).toBeNull();
    expect(await stack.locator('summary').textContent()).toBe('Show stack');
    const colors = await card.evaluate((element) =>
      ['.tone-expected', '.tone-received'].map((selector) => element.ownerDocument.defaultView!.getComputedStyle(element.querySelector(selector)!).color),
    );
    expect(colors).toEqual(colorScheme === 'light' ? ['rgb(31, 107, 58)', 'rgb(179, 38, 30)'] : ['rgb(127, 199, 154)', 'rgb(242, 139, 130)']);
    expect(errors).toEqual([]);
    await page.close();
  });

  it('shows a multi-line toEqual diff, colored inside its block only', async () => {
    const { page } = await open(testHash(find('returns a different order (intentional)')));
    const message = page.locator('.error-card .error-message').first();
    await message.waitFor();
    expect(await message.locator('.tone-expected').allTextContents()).toEqual(['- Expected  - 2', '-     "lamp",', '-   "status": "paid",']);
    expect(await message.locator('.tone-received').allTextContents()).toEqual(['+ Received  + 2', '+     "pen",', '+   "status": "pending",']);
    await page.close();
  });

  it('links an error to its group, without category context', async () => {
    const failing = find('fails on a wrong heading (intentional)');
    const { page } = await open(`${testHash(failing)}?category=Assertion`);
    const link = page.getByRole('link', { name: /View error group/ });
    const group = errorGroups(report).find((candidate) => candidate.signature === failing.errorSignature)!;
    expect(await link.textContent()).toBe(`View error group (${group.tests.length} tests)`);
    await link.click();
    await page.locator('.group-sample').waitFor();
    expect(hashOf(page)).toBe(`#/group/${group.signature}`);
    expect(await page.getByRole('navigation', { name: 'Error groups' }).count()).toBe(1);
    await page.close();
  });

  it('shows test.step entries with the failing path expanded, and every step with steps=all', async () => {
    const nested = find('fails inside a nested step (intentional)');
    const { page, errors } = await open(testHash(nested));
    const steps = page.locator('.detail-section', { has: page.getByRole('heading', { name: 'Steps' }) });
    await steps.waitFor();
    const titles = () => steps.locator('.step-title').allTextContents();
    expect(await titles()).toEqual(['open the cart', 'check the total', 'Expect "toHaveText"']);
    expect(await steps.locator('.step-failing-path > .step-row .step-title').allTextContents()).toEqual(await titles());
    expect(await steps.locator('.step-failing .step-title').textContent()).toBe('Expect "toHaveText"');
    expect(await steps.locator('.step-failing .visually-hidden').last().textContent()).toBe(' (failing step)');
    // The error is shown once, on the step it comes from, without the stack.
    expect(await steps.locator('pre.step-error').count()).toBe(1);
    const toggle = steps.getByRole('button', { name: 'Collapse open the cart' });
    expect(await toggle.getAttribute('aria-expanded')).toBe('true');
    await toggle.click();
    expect(await titles()).toEqual(['open the cart']);
    await steps.getByRole('button', { name: 'Expand open the cart' }).click();

    const showAll = steps.getByRole('button', { name: 'Show all steps' });
    expect(await showAll.getAttribute('aria-pressed')).toBe('false');
    await showAll.click();
    await expect.poll(() => hashOf(page)).toBe(`${testHash(nested)}?steps=all`);
    expect(await showAll.getAttribute('aria-pressed')).toBe('true');
    expect(await titles()).toEqual(expect.arrayContaining(['Before Hooks', 'open the cart', 'Set content', 'check the total', 'After Hooks']));
    expect(await steps.locator('.step-category').first().textContent()).toBe('hook');
    // The view mode is kept from the URL.
    await page.reload();
    await expect.poll(() => steps.getByRole('button', { name: 'Show all steps' }).getAttribute('aria-pressed')).toBe('true');
    expect(errors).toEqual([]);
    await page.close();
  });

  it('lists attachments per attempt, grouped by kind, with relative links and inline text', async () => {
    const screenshot = find('differs from the screenshot baseline (intentional)');
    const { page } = await open(testHash(screenshot));
    const section = page.locator('.detail-section', { has: page.getByRole('heading', { name: 'Attachments' }) });
    await section.waitFor();
    const attempt = screenshot.attempts[screenshot.attempts.length - 1]!;
    expect(await section.locator('h3').allTextContents()).toEqual(
      ['screenshot', 'video', 'trace', 'text', 'other']
        .filter((kind) => attempt.attachments.some((attachment) => attachment.kind === kind))
        .map((kind) => expect.stringMatching(new RegExp(`^${{ screenshot: 'Screenshots', video: 'Videos', trace: 'Traces', text: 'Text', other: 'Other' }[kind]}`))),
    );
    const files = attempt.attachments.filter((attachment) => attachment.path);
    // Every file is linked: as a list item, or from its viewer ("Open original").
    expect(await section.locator('a').evaluateAll((links) => links.map((link) => link.getAttribute('href')))).toEqual(
      expect.arrayContaining(files.map((attachment) => attachment.path)),
    );
    await page.close();

    const flaky = find('is flaky: fails on the first attempt, passes on retry (intentional)');
    const second = await open(testHash(flaky));
    const body = second.page.locator('details.attachment-body');
    expect(await body.getAttribute('open')).toBeNull();
    expect(await body.locator('summary').textContent()).toBe('attempttext/plain · 9 B');
    await body.locator('summary').click();
    expect(await body.locator('pre').textContent()).toBe('attempt 0');
    await second.page.close();
  });

  it('shows stdout and stderr collapsed, with a notice when truncated', async () => {
    const output = find('writes to stdout and stderr');
    const truncated = {
      ...report,
      tests: report.tests.map((test) =>
        test === output ? { ...test, attempts: test.attempts.map((attempt) => ({ ...attempt, stdout: { text: 'x'.repeat(100), truncated: true } })) } : test,
      ),
    };
    const { page } = await open(testHash(output), { reportUrl: writeReport('truncated', truncated) });
    const blocks = page.locator('details.output-block');
    await expect.poll(() => blocks.count()).toBe(2);
    expect(await blocks.locator('summary').allTextContents()).toEqual(['stdout1 linetruncated', 'stderr1 line']);
    expect(await blocks.first().getAttribute('open')).toBeNull();
    await blocks.first().locator('summary').click();
    expect(await blocks.first().locator('.output-notice').textContent()).toContain('Truncated');
    await page.close();
  });

  it("shows an attempt's own annotations only, each once", async () => {
    const failing = find('fails on a wrong heading (intentional)');
    const section = (page: Page) => page.getByRole('region', { name: 'Annotations of this attempt' });
    const first = await open(testHash(failing));
    await first.page.getByRole('heading', { name: 'Error' }).waitFor();
    // The attempt's copy of the test's annotation is not its own.
    expect(await section(first.page).count()).toBe(0);
    await first.page.close();

    const runtime = { type: 'runtime', description: 'added' };
    const annotated = {
      ...report,
      tests: report.tests.map((test) =>
        test === failing ? { ...test, attempts: test.attempts.map((attempt) => ({ ...attempt, annotations: [...attempt.annotations, runtime, runtime] })) } : test,
      ),
    };
    const second = await open(testHash(failing), { reportUrl: writeReport('annotated', annotated) });
    await expect.poll(() => section(second.page).count()).toBe(1);
    expect(await section(second.page).getByRole('listitem').allTextContents()).toEqual(['runtime: added']);
    await second.page.close();
  });

  it('copies the rerun commands and the AI prompt, and announces it', async () => {
    const failing = find('fails on a wrong heading (intentional)');
    const { page, errors } = await open(testHash(failing), { init: CLIPBOARD_STUB });
    const copied = () => page.evaluate<string[]>('window.__copied');
    const button = page.getByRole('button', { name: 'Copy rerun command', exact: true });
    expect(await button.getAttribute('title')).toContain('from the folder that holds your Playwright config');
    await button.click();
    await expect.poll(copied).toEqual([rerunCommand([failing])]);
    await expect.poll(() => page.getByRole('status').textContent()).toContain('Rerun command copied to the clipboard.');
    // It says so on screen, its accessible name unchanged: the live region is what announces the copy.
    expect(await page.locator('.test-actions .copy-button').first().textContent()).toBe('Copy rerun command · Copied');
    expect(await button.isVisible()).toBe(true);

    // Its file has no other failed test: the same test failing in the other project does not count.
    expect(await page.getByRole('button', { name: /failed tests? in this file/ }).count()).toBe(0);
    expect(await button.getAttribute('title')).not.toMatch(/file:line|has not changed/);

    await page.getByRole('button', { name: 'Copy AI prompt' }).click();
    await expect.poll(async () => (await copied())[1] ?? '').toContain('Explain the most likely cause');
    const prompt = (await copied())[1] ?? '';
    expect(prompt).toContain('Expected: "Wrong heading"');
    // Its only frame is the error location, printed already: no stack block.
    expect(prompt).toContain(`\nLocation: ${failing.file}:`);
    // The line of the test can be a line of the compiled file: left out.
    expect(prompt).toContain(`- File: ${failing.file}\n`);
    expect(prompt).not.toContain('- Location:');
    expect(prompt).not.toContain('Stack:');
    // Each attempt holds a copy of the test's annotation: listed once.
    expect(prompt).toContain('- Annotations: bug: BUG-1\n');
    expect(errors).toEqual([]);
    await page.close();
  });

  it('announces each copy once, with its outcome, and keeps the button name', async () => {
    const failing = find('fails on a wrong heading (intentional)');
    const message = 'AI prompt copied to the clipboard.';
    const { page, errors } = await open(testHash(failing), { init: CLIPBOARD_STUB + ANNOUNCEMENTS });
    const announced = () => page.evaluate<string[]>('window.__announced');
    const prompt = page.getByRole('button', { name: 'Copy AI prompt', exact: true });
    await prompt.click();
    await expect.poll(announced).toEqual([message]);
    // "· Copied" is shown, not part of the name: a change of the focused button's name is read by screen readers.
    expect(await page.locator('.copy-done').isVisible()).toBe(true);
    expect(await prompt.isVisible()).toBe(true);
    // The same copy again: the region is emptied, then the message written again.
    await prompt.click();
    await expect.poll(announced).toEqual([message, '', message]);
    // Another copy: cleared first too, so its whole message is new text.
    await page.getByRole('button', { name: 'Copy rerun command', exact: true }).click();
    await expect.poll(announced).toEqual([message, '', message, '', 'Rerun command copied to the clipboard.']);
    await page.waitForTimeout(300);
    expect(await announced()).toHaveLength(5);
    expect(errors).toEqual([]);
    await page.close();
  });

  it('announces nothing when the Clipboard API refuses: the fallback dialog opens instead', async () => {
    const failing = find('fails on a wrong heading (intentional)');
    const { page, errors } = await open(testHash(failing), { init: CLIPBOARD_REFUSED + ANNOUNCEMENTS });
    await page.getByRole('button', { name: 'Copy AI prompt' }).click();
    // The acronym keeps its case in the title.
    await page.getByRole('dialog', { name: 'Copy AI prompt' }).waitFor();
    await page.waitForTimeout(300);
    expect(await page.evaluate<string[]>('window.__announced')).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  });

  it('copies the failed tests of the file, one command for the projects that share them', async () => {
    const timeout = find('times out (intentional)');
    const { page } = await open(testHash(timeout), { init: CLIPBOARD_STUB });
    const failedInFile = report.tests.filter((test) => test.file === timeout.file && test.outcome === 'failed');
    const count = failedInFile.filter((test) => test.project === 'chromium-a').length;
    const fileButton = page.getByRole('button', { name: `Copy rerun command · ${count} failed tests in this file, in chromium-a, chromium-b` });
    await fileButton.click();
    await expect.poll(async () => (await page.evaluate<string[]>('window.__copied'))[0]).toBe(rerunCommand(failedInFile));
    await page.close();
  });

  it('gives the stack frames in the AI prompt, and leaves them out when configured', async () => {
    const failing = find('downloads an invoice (intentional)');
    const copy = async (reportUrl = url): Promise<string> => {
      const { page } = await open(testHash(failing), { init: CLIPBOARD_STUB, reportUrl });
      await page.getByRole('button', { name: 'Copy AI prompt' }).click();
      await expect.poll(async () => ((await page.evaluate<string[]>('window.__copied'))[0] ?? '').length).toBeGreaterThan(0);
      const prompt = (await page.evaluate<string[]>('window.__copied'))[0] ?? '';
      await page.close();
      return prompt;
    };
    const prompt = await copy();
    expect(prompt).toMatch(/\nStack:\n```\n {4}at checkResponse \(\.\.\/helpers\/resources\.ts:\d+:\d+\)\n/);
    // The message is printed once, above the stack.
    const message = failing.attempts.at(-1)?.errors[0]?.message.split('\n')[0] ?? '';
    expect(prompt.split(message)).toHaveLength(2);
    expect(await copy(writeReport('no-stack', report, { ...DEFAULT_RENDERER_SETTINGS, aiPrompt: { includeStack: false } }))).not.toContain('Stack:');
  });

  it('falls back to a dialog with the text selected when the Clipboard API is missing', async () => {
    const failing = find('fails on a wrong heading (intentional)');
    const { page, errors } = await open(testHash(failing), { init: NO_CLIPBOARD });
    const button = page.getByRole('button', { name: 'Copy rerun command', exact: true });
    await button.click();
    const dialog = page.getByRole('dialog', { name: 'Copy rerun command' });
    await dialog.waitFor();
    const area = dialog.getByRole('textbox');
    expect(await area.inputValue()).toBe(rerunCommand([failing]));
    expect(await area.evaluate((element) => element === element.ownerDocument.activeElement && (element as unknown as { selectionEnd: number }).selectionEnd > 0)).toBe(true);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    expect(await button.evaluate((element) => element === element.ownerDocument.activeElement)).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  });

  /** The report with `count` more failed tests, each with a title of 3,000 characters: about 3,000 characters of command each. */
  function withLongTitles(count: number): LoupeReport {
    const failing = find('fails on a wrong heading (intentional)');
    const added = Array.from({ length: count }, (_, index) => ({ ...failing, id: `${index}`.padStart(16, 'f'), title: `${index} ${'x'.repeat(3000)}` }));
    return { ...report, tests: [...report.tests, ...added] };
  }

  it('warns above the Windows limit, still copying, with one announcement', async () => {
    const failing = find('fails on a wrong heading (intentional)');
    const { page, errors } = await open('#/tests?project=chromium-a', { init: CLIPBOARD_STUB + ANNOUNCEMENTS, reportUrl: writeReport('long-command', withLongTitles(3)) });
    const button = page.locator('.rerun-failed .copy-button');
    const note = page.locator('.rerun-failed .rerun-note');
    await note.waitFor();
    expect(await note.textContent()).toBe('Too long for Windows, which accepts 8,191 characters: run it in bash or zsh on Linux or macOS, or rerun fewer tests.');
    // Read with the button, and not as an announcement.
    expect(await page.locator(`#${await button.getAttribute('aria-describedby')}`).textContent()).toContain('Too long for Windows');
    await button.click();
    await expect.poll(async () => (await page.evaluate<string[]>('window.__copied')).length).toBe(1);
    expect((await page.evaluate<string[]>('window.__copied'))[0]).toContain(failing.title.split(' ')[0]);
    await expect.poll(() => page.evaluate<string[]>('window.__announced')).toEqual(['Rerun command copied to the clipboard.']);
    expect(errors).toEqual([]);
    await page.close();
  });

  it('does not copy above the Linux limit: the button stays reachable, explains, and --last-failed is the way out', async () => {
    const { page, errors } = await open('#/tests?project=chromium-a', { init: CLIPBOARD_STUB + ANNOUNCEMENTS, reportUrl: writeReport('too-long-command', withLongTitles(50)) });
    const button = page.locator('.rerun-failed .copy-button');
    const note = page.locator('.rerun-failed .rerun-note');
    await note.waitFor();
    expect(await note.textContent()).toMatch(/^Too long to copy: [\d,]+ bytes, above the 131,072 of a Linux argument\. npx playwright test --last-failed reruns the failures of the last local run, which can differ from this report\.$/);

    // aria-disabled, not disabled: announced as unavailable, with its reason, and still in the tab order.
    expect(await button.getAttribute('aria-disabled')).toBe('true');
    expect(await button.evaluate((element) => element.hasAttribute('disabled'))).toBe(false);
    expect(await button.getAttribute('title')).toBe(await note.textContent());
    expect(await button.getAttribute('aria-describedby')).toBe(await note.getAttribute('id'));
    const isFocused = (): Promise<boolean> => button.evaluate((element) => element === element.ownerDocument.activeElement);
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    for (let tabs = 0; tabs < 100 && !(await isFocused()); tabs += 1) await page.keyboard.press('Tab');
    expect(await isFocused()).toBe(true);

    // Activating it does nothing, with the keyboard or the mouse: no copy, no fallback dialog, no announcement.
    const url = page.url();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    await button.click({ force: true });
    expect(await isFocused()).toBe(true);
    expect(page.url()).toBe(url);
    expect(await page.evaluate<string[]>('window.__copied')).toEqual([]);
    expect(await page.evaluate<string[]>('window.__announced')).toEqual([]);
    expect(await page.getByRole('dialog').count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  });

  it('opens no fallback dialog above the Linux limit, even without the Clipboard API', async () => {
    const { page } = await open('#/tests?project=chromium-a', { init: NO_CLIPBOARD, reportUrl: writeReport('too-long-no-clipboard', withLongTitles(50)) });
    const button = page.locator('.rerun-failed .copy-button');
    await button.waitFor();
    await button.focus();
    await page.keyboard.press('Enter');
    await button.click({ force: true });
    expect(await page.getByRole('dialog').count()).toBe(0);
    await page.close();
  });

  it('applies the limits to the failed tests of the file too', async () => {
    const failing = find('fails on a wrong heading (intentional)');
    const { page } = await open(testHash(failing), { init: CLIPBOARD_STUB, reportUrl: writeReport('too-long-file', withLongTitles(50)) });
    await page.locator('.test-actions .rerun-note').waitFor();
    expect(await page.getByRole('button', { name: /in this file/ }).getAttribute('aria-disabled')).toBe('true');
    expect(await page.getByRole('button', { name: 'Copy rerun command', exact: true }).getAttribute('aria-disabled')).toBeNull();
    await page.close();
  });

  it('copies the failed tests of the current list, from the Tests view and the overview', async () => {
    const failed = report.tests.filter((test) => test.outcome === 'failed');
    const { page } = await open('#/tests', { init: CLIPBOARD_STUB });
    const button = page.getByRole('button', { name: new RegExp(`^Copy rerun command · ${failed.length} failed tests`) });
    await button.click();
    const command = (await page.evaluate<string[]>('window.__copied'))[0] ?? '';
    // Both projects failed on the same tests: one command with both projects. Flaky tests left out.
    expect(command).toBe(rerunCommand(failed));
    expect(command).toContain(' --project=chromium-a --project=chromium-b -g ');
    expect(command).toContain('(chromium-a|chromium-b)');
    expect(command).not.toContain('is flaky');

    await page.goto(`${url}#/tests?project=chromium-b`);
    const projectFailed = failed.filter((test) => test.project === 'chromium-b');
    await page.getByRole('button', { name: new RegExp(`^Copy rerun command · ${projectFailed.length} failed tests`) }).waitFor();

    // The overview's action follows the current filter too.
    await page.goto(`${url}#/?project=chromium-b`);
    await page.getByRole('button', { name: new RegExp(`^Rerun failed tests · ${projectFailed.length} failed tests`) }).click();
    // Same document (a hash change): the copy from the Tests view is still recorded.
    await expect.poll(async () => (await page.evaluate<string[]>('window.__copied')).length).toBe(2);
    await page.close();
  });

  it('walks the current list with Previous / Next and j / k, keeping the filters, without wrapping', async () => {
    const failed = report.tests.filter((test) => test.outcome === 'failed');
    // Read from the table: the Tests view's order is the reference.
    const { page, errors } = await open('#/tests?status=failed');
    const links = page.locator('.tests-table tbody .cell-title > a');
    const rows = await links.allTextContents();
    expect(rows).toHaveLength(failed.length);
    const lastHref = (await links.last().getAttribute('href')) ?? '';
    await page.locator('.tests-table tbody .cell-title > a').first().click();
    const pager = page.getByRole('navigation', { name: 'Tests in the current list' });
    await expect.poll(() => pager.locator('.pager-position').textContent()).toBe(`1 of ${failed.length}`);
    expect(await pager.getByRole('button', { name: 'Previous' }).isDisabled()).toBe(true);
    expect(await page.getByRole('heading', { level: 1 }).textContent()).toBe(rows[0]);

    await page.keyboard.press('j');
    await expect.poll(() => pager.locator('.pager-position').textContent()).toBe(`2 of ${failed.length}`);
    expect(await page.getByRole('heading', { level: 1 }).textContent()).toBe(rows[1]);
    expect(hashOf(page)).toMatch(/\?status=failed$/);
    await page.keyboard.press('k');
    await expect.poll(() => pager.locator('.pager-position').textContent()).toBe(`1 of ${failed.length}`);
    await pager.getByRole('button', { name: 'Next' }).click();
    await expect.poll(() => pager.locator('.pager-position').textContent()).toBe(`2 of ${failed.length}`);

    // Single keys do nothing while typing.
    await page.getByRole('searchbox', { name: 'Search tests' }).focus();
    await page.keyboard.press('j');
    expect(await pager.locator('.pager-position').textContent()).toBe(`2 of ${failed.length}`);
    await page.getByRole('searchbox', { name: 'Search tests' }).fill('');

    // The last test: Next disabled, j does nothing.
    await page.goto(`${url}${lastHref}`);
    await expect.poll(() => pager.locator('.pager-position').textContent()).toBe(`${failed.length} of ${failed.length}`);
    expect(await pager.getByRole('button', { name: 'Next' }).isDisabled()).toBe(true);
    await page.locator('body').press('j');
    expect(await pager.locator('.pager-position').textContent()).toBe(`${failed.length} of ${failed.length}`);
    expect(errors).toEqual([]);
    await page.close();
  });

  it('opens each test of the list on its default attempt', async () => {
    const flaky = find('is flaky: fails on the first attempt, passes on retry (intentional)');
    const { page } = await open(`${testHash(flaky)}?status=flaky&attempt=1`);
    await page.getByRole('tab', { selected: true, name: /Retry 1/ }).waitFor();
    await page.locator('body').press('j');
    await expect.poll(() => hashOf(page)).toMatch(/^#\/test\/[0-9a-f]{16}\?status=flaky$/);
    await page.close();
  });

  it('walks every error group from the global list, and a category from a category section, with j / k', async () => {
    const ranked = rankGroups(errorGroups(report));
    const { page, errors } = await open('#/errors');
    await page.locator('.widget-groups a.group-row').first().click();
    const pager = page.getByRole('navigation', { name: 'Error groups' });
    await expect.poll(() => pager.locator('.pager-position').textContent()).toBe(`1 of ${ranked.length}`);
    expect(hashOf(page)).toBe(`#/group/${ranked[0]!.signature}`);
    expect(await pager.getByRole('button', { name: 'Previous group' }).isDisabled()).toBe(true);
    await page.keyboard.press('j');
    await expect.poll(() => hashOf(page)).toBe(`#/group/${ranked[1]!.signature}`);
    await page.keyboard.press('k');
    await expect.poll(() => hashOf(page)).toBe(`#/group/${ranked[0]!.signature}`);
    // n / p are gone.
    await page.keyboard.press('n');
    await page.evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    expect(hashOf(page)).toBe(`#/group/${ranked[0]!.signature}`);

    // From a category: the sequence stays within it.
    const category = 'Assertion';
    const inCategory = ranked.filter((group) => group.category === category);
    expect(inCategory.length).toBeGreaterThan(1);
    await page.goto(`${url}#/errors/category/${category}`);
    await page.locator(`[data-category="${category}"] a.group-row`).first().click();
    const restricted = page.getByRole('navigation', { name: `Error groups in ${category}` });
    await expect.poll(() => restricted.locator('.pager-position').textContent()).toBe(`1 of ${inCategory.length}`);
    expect(hashOf(page)).toBe(`#/group/${inCategory[0]!.signature}?category=${category}`);
    for (const group of inCategory.slice(1)) {
      await page.keyboard.press('j');
      await expect.poll(() => hashOf(page)).toBe(`#/group/${group.signature}?category=${category}`);
    }
    expect(await restricted.getByRole('button', { name: 'Next group' }).isDisabled()).toBe(true);
    await page.keyboard.press('j');
    expect(hashOf(page)).toBe(`#/group/${inCategory[inCategory.length - 1]!.signature}?category=${category}`);
    expect(errors).toEqual([]);
    await page.close();
  });

  it('shows the keyboard shortcuts with ? and from the header button, with focus kept in the dialog and returned on close', async () => {
    const { page, errors } = await open('#/tests');
    const opener = page.getByRole('button', { name: 'Keyboard shortcuts' });
    await opener.focus();
    await page.keyboard.press('?');
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await dialog.waitFor();
    expect(await dialog.locator('tbody tr').count()).toBe(10);
    expect(await dialog.textContent()).toContain('Next / previous test, or error group');
    // Tab cycles within the dialog: the rest of the page is inert.
    for (let index = 0; index < 4; index++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate<boolean>("document.querySelector('dialog[open]').contains(document.activeElement) || document.activeElement === document.body")).toBe(true);
    }
    // Shortcuts are off while it is open.
    await page.keyboard.press('j');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    expect(await opener.evaluate((element) => element === element.ownerDocument.activeElement)).toBe(true);

    await opener.click();
    await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await dialog.waitFor({ state: 'hidden' });
    expect(await opener.evaluate((element) => element === element.ownerDocument.activeElement)).toBe(true);

    // Not while typing in the search field, nor with a modifier.
    await page.getByRole('searchbox', { name: 'Search tests' }).focus();
    await page.keyboard.press('?');
    await page.locator('body').press('Control+?');
    expect(await dialog.isVisible()).toBe(false);
    expect(errors).toEqual([]);
    await page.close();
  });
});
