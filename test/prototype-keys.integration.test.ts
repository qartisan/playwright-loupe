import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KEYS } from '../fixtures/prototype-keys/keys.js';
import type { LoupeReport } from '../src/schema/v1.js';
import { assertBuilt, playwright, readReport } from './helpers/fixtures.js';
import { schemaErrors } from './helpers/schema.js';

/**
 * `__proto__`, `constructor` and `toString` as a tag prefix, a tag value, an annotation type, a
 * project name, a category and a dimension name, in real runs of fixtures/prototype-keys.config.ts:
 * the run keeps the exit code of its tests, and the report opens.
 */
describe('prototype-like names, end to end', { timeout: 120_000 }, () => {
  let workDir: string;
  let browser: Browser;
  const runs = new Map<string, { status: number | null; output: string; folder: string; report: LoupeReport }>();

  const run = (name: string, env: Record<string, string> = {}): void => {
    const folder = path.join(workDir, name);
    const { status, output } = playwright(['test', '--config', 'fixtures/prototype-keys.config.ts', '--output', path.join(workDir, `results-${name}`)], {
      LOUPE_FIXTURE_OUTPUT: folder,
      ...env,
    });
    runs.set(name, { status, output, folder, report: readReport(folder, `Exit code ${status}.\n${output}`) });
  };
  const result = (name: string) => {
    const known = runs.get(name);
    if (!known) throw new Error(`No run ${name}`);
    return known;
  };

  async function open(name: string, fragment: string): Promise<{ page: Page; errors: string[] }> {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(`${pathToFileURL(path.join(result(name).folder, 'index.html')).href}${fragment}`);
    await page.locator('main').waitFor();
    return { page, errors };
  }

  beforeAll(async () => {
    assertBuilt();
    workDir = mkdtempSync(path.join(tmpdir(), 'loupe-prototype-'));
    run('passing');
    run('failing', { LOUPE_FIXTURE_FAIL: '1' });
    browser = await chromium.launch();
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    rmSync(workDir, { recursive: true, force: true });
  });

  it('keeps the exit code of the tests', () => {
    expect(result('passing').status, result('passing').output).toBe(0);
    expect(result('failing').status, result('failing').output).toBe(1);
    for (const name of ['passing', 'failing']) {
      expect(result(name).output).not.toMatch(/Error in reporter|TypeError/);
      expect(result(name).report.tests).toHaveLength(KEYS.length * KEYS.length);
      expect(schemaErrors(result(name).report)).toEqual([]);
    }
  });

  it('keeps each name as a project, a title, a describe, a tag and an annotation type', () => {
    const { report } = result('passing');
    expect(report.projects.map((project) => project.name).sort()).toEqual([...KEYS].sort());
    for (const key of KEYS) {
      const test = report.tests.find((candidate) => candidate.title === key);
      expect(test?.suitePath).toEqual([key]);
      expect(test?.tags).toEqual([`@${key}:prefix`, `@value:${key}`, `@${key}`]);
      expect(test?.annotations).toEqual([{ type: key, description: key }]);
    }
  });

  it('keeps each name as a tag prefix and a tag value in the dimensions', () => {
    const { folder, report } = result('passing');
    expect(report.dimensions.map((dimension) => dimension.name)).toEqual(expect.arrayContaining([...KEYS, 'value']));
    // Read as text: `__proto__` must be a key of the JSON, not a prototype lost on the way.
    expect(readFileSync(path.join(folder, 'report.json'), 'utf8')).toMatch(/"__proto__":\s*\[\s*"prefix"/);
    for (const key of KEYS) {
      const test = report.tests.find((candidate) => candidate.title === key) as { dimensions: Record<string, string[]> };
      expect(Object.keys(test.dimensions).sort()).toEqual([key, 'value'].sort());
      expect(Object.getOwnPropertyDescriptor(test.dimensions, key)?.value).toEqual(['prefix']);
      expect(test.dimensions['value']).toEqual([key]);
    }
  });

  it('keeps each name as a category and a declared dimension', () => {
    const { report } = result('failing');
    expect(report.categories.map((category) => category.name)).toEqual(expect.arrayContaining([...KEYS]));
    expect(report.dimensions.map((dimension) => dimension.name)).toEqual(expect.arrayContaining([...KEYS]));
    for (const key of KEYS) {
      const test = report.tests.find((candidate) => candidate.title === key);
      expect(test?.category).toBe(key);
      expect(Object.getOwnPropertyDescriptor(test?.dimensions, key)?.value).toEqual([key]);
    }
  });

  it('writes an attachment with such a content type under a plain file name', () => {
    for (const test of result('passing').report.tests) {
      const attachment = test.attempts[0]?.attachments.find((candidate) => candidate.name === test.title);
      expect(attachment?.path).toMatch(/\/[\w-]+\.\w+$/);
      expect(attachment?.path).not.toContain('function');
      expect(attachment?.path).not.toContain('[object');
    }
  });

  it.each(['passing', 'failing'])('opens the %s report on every view, with no error', async (name) => {
    const { report } = result(name);
    const id = report.tests[0]?.id ?? '';
    const value = (key: string): string => (name === 'passing' ? 'prefix' : key);
    for (const fragment of ['#/', '#/tests', '#/errors', `#/test/${id}`, ...KEYS.map((key) => `#/tests?dim.${key}=${value(key)}`)]) {
      const { page, errors } = await open(name, fragment);
      await page.waitForTimeout(50);
      expect(errors, `${name} ${fragment}`).toEqual([]);
      expect(await page.locator('main').innerText(), `${name} ${fragment}`).not.toBe('');
      await page.close();
    }
  });

  it('shows each name in the dimension widgets and filters on it', async () => {
    const { page, errors } = await open('passing', '#/');
    const text = await page.locator('main').innerText();
    for (const key of KEYS) expect(text).toContain(key);
    await page.close();
    for (const key of KEYS) {
      const filtered = await open('passing', `#/tests?dim.${key}=prefix`);
      const rows = filtered.page.locator('main table tbody tr');
      // One test per project carries the prefix.
      await expect.poll(() => rows.count()).toBe(KEYS.length);
      expect(filtered.errors).toEqual([]);
      await filtered.page.close();
    }
    expect(errors).toEqual([]);
  });
});
