import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SUPPORT_URL, MIN_PLAYWRIGHT_TRACE_VIEWER, MIN_PLAYWRIGHT_SUPPORTED, isBelow } from '../src/core/support.js';
import { TRACE_VIEWER_FOLDER, bundleTraceViewer, findPlaywrightCore } from '../src/core/traceViewer.js';
import { ROOT } from './helpers/fixtures.js';

describe('the trace viewer', () => {
  let workDir: string;
  let outputFolder: string;

  /** A package in the temporary folder, with the given `package.json` and viewer files. */
  function fakeCore(manifest: unknown, files: Record<string, string> = {}, folder = 'node_modules/playwright-core'): string {
    const root = path.join(workDir, folder);
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, 'package.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
    for (const [file, text] of Object.entries(files)) {
      const target = path.join(root, 'lib/vite/traceViewer', file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, text);
    }
    return root;
  }

  const copied = (): string[] => {
    const target = path.join(outputFolder, TRACE_VIEWER_FOLDER);
    if (!existsSync(target)) return [];
    return readdirSync(target, { recursive: true, encoding: 'utf8' }).map((file) => file.replaceAll('\\', '/')).sort();
  };

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), 'loupe-viewer-'));
    outputFolder = path.join(workDir, 'report');
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  describe('findPlaywrightCore', () => {
    const CORE = { name: 'playwright-core', version: '1.64.1' };

    it('finds the installed Playwright from a config directory, through its dependents', () => {
      const core = findPlaywrightCore(ROOT, []);
      expect(core?.root).toBe(path.join(ROOT, 'node_modules/playwright-core'));
      expect(core?.version).toEqual(expect.any(String));
    });

    it('prefers the loaded package to the one the config directory finds', () => {
      const root = fakeCore(CORE);
      expect(findPlaywrightCore(ROOT, [path.join(root, 'lib/server.js')])).toEqual({ root, version: '1.64.1' });
    });

    it('reads a pnpm path, whose store folder also holds the name', () => {
      const folder = 'node_modules/.pnpm/playwright-core@1.64.1/node_modules/playwright-core';
      const root = fakeCore(CORE, {}, folder);
      expect(findPlaywrightCore(workDir, [path.join(root, 'index.js')])?.root).toBe(root);
    });

    it('takes no folder that merely has the name for the package', () => {
      const project = fakeCore({ name: 'my-tests', version: '9.9.9' }, {}, 'playwright-core');
      const root = fakeCore(CORE);
      const files = [path.join(project, 'playwright.config.js'), path.join(root, 'index.js')];
      expect(findPlaywrightCore(workDir, files)?.root).toBe(root);
    });

    it.each([
      ['a package.json that is not JSON', '{'],
      ['a null package.json', 'null'],
    ])('falls back to the config directory on %s', (_name, manifest) => {
      const root = fakeCore(manifest);
      expect(findPlaywrightCore(ROOT, [path.join(root, 'index.js')])?.root).toBe(path.join(ROOT, 'node_modules/playwright-core'));
    });

    it('returns null when nothing is found, and never throws', () => {
      expect(findPlaywrightCore(workDir, [])).toBeNull();
      expect(findPlaywrightCore(path.join(workDir, 'missing'), ['', '/playwright-core/', 'playwright-core'])).toBeNull();
    });
  });

  describe('bundleTraceViewer', () => {
    const bundle = (...[root, version, blobVersion]: [root: string | null, version?: unknown, blobVersion?: string]) =>
      bundleTraceViewer({ outputFolder, core: root === null ? null : { root, version }, blobVersion: blobVersion ?? null });

    it('copies the whole folder, whatever the names of its files', async () => {
      const root = fakeCore({}, { 'index.html': 'viewer', 'sw.bundle.js': 'worker', 'assets/xtermModule-abc.js': 'x', 'code.js.map': 'map', 'watch.js': 'w' });
      expect(await bundle(root, '1.64.1')).toEqual({ copied: true, warning: null });
      expect(copied()).toEqual(['assets', 'assets/xtermModule-abc.js', 'code.js.map', 'index.html', 'sw.bundle.js', 'watch.js']);
      expect(readFileSync(path.join(outputFolder, TRACE_VIEWER_FOLDER, 'index.html'), 'utf8')).toBe('viewer');
    });

    it('writes every file writable, from a read-only source', async () => {
      const root = fakeCore({}, { 'index.html': 'viewer' });
      const source = path.join(root, 'lib/vite/traceViewer/index.html');
      chmodSync(source, 0o444);
      expect((await bundle(root, '1.64.1')).copied).toBe(true);
      expect(statSync(path.join(outputFolder, TRACE_VIEWER_FOLDER, 'index.html')).mode & 0o200).toBe(0o200);
    });

    it.each(['1.61.0', '1.61.0-alpha-2026-05-01', '1.64.1', '2.0.0'])('copies from Playwright %s', async (version) => {
      expect((await bundle(fakeCore({}, { 'index.html': 'viewer' }), version)).copied).toBe(true);
    });

    it.each(['1.60.0', '1.57.0', '1.52.0', '1.60.9-beta'])('refuses Playwright %s, whose viewer contacts third parties', async (version) => {
      const result = await bundle(fakeCore({}, { 'index.html': 'viewer' }), version);
      expect(result.copied).toBe(false);
      expect(result.warning).toBe(
        `Loupe: traceViewer "bundled" needs Playwright ${MIN_PLAYWRIGHT_TRACE_VIEWER} or later; this is ${version}. The report is written without the trace viewer. See ${SUPPORT_URL}`,
      );
      expect(copied()).toEqual([]);
    });

    it.each([undefined, null, 42, '', 'next', { major: 1 }])('refuses a version it cannot read: %j', async (version) => {
      const result = await bundle(fakeCore({}, { 'index.html': 'viewer' }), version);
      expect(result.copied).toBe(false);
      expect(result.warning).toContain('its version cannot be read');
      expect(copied()).toEqual([]);
    });

    it('warns when playwright-core was not found', async () => {
      expect(await bundle(null)).toEqual({ copied: false, warning: 'Loupe: traceViewer "bundled": playwright-core was not found. The report is written without the trace viewer.' });
    });

    it('warns when the location is missing, or holds no viewer', async () => {
      const missing = await bundle(fakeCore({}), '1.64.1');
      expect(missing.copied).toBe(false);
      expect(missing.warning).toContain('Playwright 1.64.1 has no trace viewer at lib/vite/traceViewer.');
      expect(copied()).toEqual([]);

      const empty = await bundle(fakeCore({}, { 'other.js': 'x' }, 'other/playwright-core'), '1.64.1');
      expect(empty.copied).toBe(false);
      expect(copied()).toEqual([]);
    });

    it.skipIf(process.platform === 'win32')('warns on a failed copy, and leaves nothing half copied', async () => {
      const root = fakeCore({}, { 'a.js': 'kept', 'index.html': 'viewer' });
      symlinkSync(path.join(workDir, 'nowhere'), path.join(root, 'lib/vite/traceViewer/z-dangling.js'));
      expect(await bundle(root, '1.64.1')).toEqual({ copied: false, warning: 'Loupe: traceViewer "bundled": the copy failed (ENOENT). The report is written without the trace viewer.' });
      expect(copied()).toEqual([]);
    });

    it('warns when the report folder cannot hold the viewer', async () => {
      writeFileSync(outputFolder, 'a file');
      const result = await bundle(fakeCore({}, { 'index.html': 'viewer' }), '1.64.1');
      expect(result.copied).toBe(false);
      expect(result.warning).toMatch(/^Loupe: traceViewer "bundled": the copy failed \(E[A-Z]+\)\./);
    });

    it('warns under merge-reports when the blobs are newer, and copies', async () => {
      const root = fakeCore({}, { 'index.html': 'viewer' });
      const result = await bundle(root, '1.62.1', '1.64.1');
      expect(result.copied).toBe(true);
      expect(result.warning).toBe(
        'Loupe: merge-reports runs Playwright 1.62.1, older than the 1.64.1 of the blob reports. Traces from newer versions may not open in the bundled trace viewer.',
      );
    });

    it.each(['1.64.1', '1.64.0', '1.52.0', 'unknown', ''])('does not warn on blobs of %j', async (blobVersion) => {
      expect(await bundle(fakeCore({}, { 'index.html': 'viewer' }), '1.64.1', blobVersion)).toEqual({ copied: true, warning: null });
    });
  });

  it('asks for a Playwright at or above the supported floor', () => {
    expect(isBelow(MIN_PLAYWRIGHT_TRACE_VIEWER, MIN_PLAYWRIGHT_SUPPORTED)).toBe(false);
  });
});
