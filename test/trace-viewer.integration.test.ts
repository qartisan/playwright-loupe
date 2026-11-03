import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync, createReadStream } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer, request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIN_PLAYWRIGHT_TRACE_VIEWER, isBelow } from '../src/core/support.js';
import { ROOT, VERSION_CONFIG, assertBuilt, playwright, readReport } from './helpers/fixtures.js';
import { schemaErrors } from './helpers/schema.js';

const VIEWER_CONFIG = 'fixtures/trace-viewer.config.ts';
const { version } = createRequire(import.meta.url)('@playwright/test/package.json') as { version: string };
/** `traceViewer: 'bundled'` copies from this minimum on. */
const COPIES = !isBelow(version, MIN_PLAYWRIGHT_TRACE_VIEWER);
const INSTALLED_VIEWER = path.join(ROOT, 'node_modules/playwright-core/lib/vite/traceViewer');

function settings(folder: string): Record<string, unknown> {
  const html = readFileSync(path.join(folder, 'index.html'), 'utf8');
  const start = html.indexOf('>', html.indexOf('id="loupe-settings"')) + 1;
  return JSON.parse(html.slice(start, html.indexOf('</script>', start))) as Record<string, unknown>;
}

/** The warnings of this option: the fixture's Loupe config writes one of its own, and old Playwright versions another. */
const warnings = (output: string): string[] => output.split('\n').filter((line) => /^Loupe: (traceViewer|merge-reports)/.test(line));
const files = (folder: string): string[] => readdirSync(folder, { recursive: true, encoding: 'utf8' }).sort();

describe('the bundled trace viewer in a real run', () => {
  let workDir: string;
  let bundled: { folder: string; status: number | null; output: string };

  function run(name: string, env: Record<string, string>, config = VIEWER_CONFIG, prepare?: (folder: string) => void) {
    const folder = path.join(workDir, name);
    prepare?.(folder);
    const { status, output } = playwright(['test', '--config', config, '--output', path.join(workDir, `results-${name}`)], { LOUPE_FIXTURE_OUTPUT: folder, ...env });
    readReport(folder, `Exit code ${status}.\n${output}`);
    return { folder, status, output };
  }

  /** A previous report's viewer, with a file today's viewer does not have. */
  const staleViewer = (folder: string): void => {
    mkdirSync(path.join(folder, 'trace-viewer'), { recursive: true });
    writeFileSync(path.join(folder, 'trace-viewer', 'stale.txt'), 'from a previous run');
  };

  /** A folder passing for `playwright-core`. */
  function standIn(name: string, coreVersion: string, viewerFiles: Record<string, string>): string {
    const root = path.join(workDir, 'stand-ins', name, 'playwright-core');
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'playwright-core', version: coreVersion }));
    for (const [file, text] of Object.entries(viewerFiles)) {
      const target = path.join(root, 'lib/vite/traceViewer', file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, text);
    }
    return root;
  }

  beforeAll(() => {
    assertBuilt();
    workDir = mkdtempSync(path.join(tmpdir(), 'loupe-viewer-'));
    bundled = run('bundled', { LOUPE_TRACE_VIEWER: 'bundled' }, VIEWER_CONFIG, staleViewer);
  }, 120_000);

  afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it('keeps the report valid and the viewer out of report.json, with the run passing', () => {
    expect(bundled.status, bundled.output).toBe(0);
    const report = readReport(bundled.folder, bundled.output);
    expect(schemaErrors(report)).toEqual([]);
    expect(report.schemaVersion).toBe(1);
    expect(readFileSync(path.join(bundled.folder, 'report.json'), 'utf8')).not.toMatch(/trace-?viewer/i);
    expect(report.tests[0]?.attempts[0]?.attachments.map((attachment) => attachment.kind)).toContain('trace');
  });

  it.runIf(COPIES)(`copies the installed viewer whole, from Playwright ${MIN_PLAYWRIGHT_TRACE_VIEWER}: this fails if its location disappears`, () => {
    expect(statSync(INSTALLED_VIEWER).isDirectory()).toBe(true);
    expect(files(path.join(bundled.folder, 'trace-viewer'))).toEqual(files(INSTALLED_VIEWER));
    expect(settings(bundled.folder)['traceViewer']).toBe('trace-viewer');
    expect(warnings(bundled.output)).toEqual([]);
  });

  it.runIf(!COPIES)(`writes one warning and copies nothing below Playwright ${MIN_PLAYWRIGHT_TRACE_VIEWER}`, () => {
    expect(existsSync(path.join(bundled.folder, 'trace-viewer'))).toBe(false);
    expect(settings(bundled.folder)['traceViewer']).toBeNull();
    expect(warnings(bundled.output)).toEqual([expect.stringContaining(`needs Playwright ${MIN_PLAYWRIGHT_TRACE_VIEWER} or later; this is ${version}.`)]);
  });

  it('removes a stale viewer on every run', () => {
    expect(existsSync(path.join(bundled.folder, 'trace-viewer', 'stale.txt'))).toBe(false);
  });

  it('copies nothing with off, the default, and removes a stale viewer', () => {
    for (const [name, env] of [['off', { LOUPE_TRACE_VIEWER: 'off' }], ['default', {}]] as const) {
      const { folder, status, output } = run(name, env, VIEWER_CONFIG, staleViewer);
      expect(status, output).toBe(0);
      expect(existsSync(path.join(folder, 'trace-viewer'))).toBe(false);
      expect(settings(folder)['traceViewer']).toBeNull();
    }
  }, 120_000);

  it('copies nothing and warns about nothing without a trace, and removes a stale viewer', () => {
    const { folder, status, output } = run('no-trace', { LOUPE_TRACE_VIEWER: 'bundled' }, VERSION_CONFIG, staleViewer);
    expect(status, output).toBe(0);
    expect(existsSync(path.join(folder, 'trace-viewer'))).toBe(false);
    expect(settings(folder)['traceViewer']).toBeNull();
    expect(warnings(output)).toEqual([]);
  }, 60_000);

  it('stops the run on an invalid LOUPE_TRACE_VIEWER', () => {
    const result = playwright(['test', '--config', VIEWER_CONFIG, '--list'], { LOUPE_TRACE_VIEWER: 'on', LOUPE_FIXTURE_OUTPUT: path.join(workDir, 'invalid') });
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('LOUPE_TRACE_VIEWER must be one of "off", "bundled", got "on"');
  }, 60_000);

  /** Whatever goes wrong: one warning, exit code unchanged, a complete report, no viewer and no setting. */
  function expectWithoutViewer(name: string, core: string, warning: string): void {
    const { folder, status, output } = run(name, { LOUPE_TRACE_VIEWER: 'bundled', LOUPE_FIXTURE_PLAYWRIGHT_CORE: core }, VIEWER_CONFIG, staleViewer);
    expect(status, output).toBe(0);
    expect(output).not.toContain('Error in reporter');
    expect(warnings(output)).toEqual([expect.stringContaining(warning)]);
    const report = readReport(folder, output);
    expect(schemaErrors(report)).toEqual([]);
    expect(report.tests).toHaveLength(1);
    expect(files(folder)).toEqual(expect.arrayContaining(['data', 'index.html', 'report.json']));
    expect(existsSync(path.join(folder, 'trace-viewer'))).toBe(false);
    expect(settings(folder)['traceViewer']).toBeNull();
  }

  it('reports a viewer below the minimum, judged on its own version', () => {
    expectWithoutViewer('below', standIn('below', '1.60.0', { 'index.html': 'viewer' }), 'needs Playwright 1.61 or later; this is 1.60.0.');
  }, 60_000);

  it('reports a location that disappeared', () => {
    expectWithoutViewer('missing', standIn('missing', '1.64.1', {}), 'Playwright 1.64.1 has no trace viewer at lib/vite/traceViewer.');
  }, 60_000);

  it.skipIf(process.platform === 'win32')('reports a failed copy', () => {
    const core = standIn('broken', '1.64.1', { 'index.html': 'viewer' });
    symlinkSync(path.join(workDir, 'nowhere'), path.join(core, 'lib/vite/traceViewer/z-dangling.js'));
    expectWithoutViewer('broken', core, 'the copy failed (ENOENT).');
  }, 60_000);

  describe('under merge-reports', () => {
    let blobs: string;

    /** Merges the blob with the option on; `core` and `blobVersion` replace what the reporter reads. */
    function merge(name: string, env: Record<string, string> = {}) {
      const folder = path.join(workDir, name);
      const { status, output } = playwright(['merge-reports', '--config', VIEWER_CONFIG, blobs], { LOUPE_FIXTURE_OUTPUT: folder, LOUPE_TRACE_VIEWER: 'bundled', ...env });
      readReport(folder, `merge-reports exit code ${status}.\n${output}`);
      return { folder, status, output };
    }

    beforeAll(() => {
      const blobFolder = path.join(workDir, 'blob');
      const result = playwright(['test', '--config', VIEWER_CONFIG, '--reporter', 'blob', '--output', path.join(workDir, 'results-blob')], { PLAYWRIGHT_BLOB_OUTPUT_DIR: blobFolder });
      const zips = existsSync(blobFolder) ? readdirSync(blobFolder).filter((file) => file.endsWith('.zip')) : [];
      if (zips.length === 0) throw new Error(`No blob (exit code ${result.status}).\n${result.output}`);
      blobs = path.join(workDir, 'blobs');
      mkdirSync(blobs);
      for (const zip of zips) copyFileSync(path.join(blobFolder, zip), path.join(blobs, zip));
    }, 120_000);

    it.runIf(COPIES)('copies the viewer of the Playwright that merges', () => {
      const { folder, status, output } = merge('merged');
      expect(status, output).toBe(0);
      expect(files(path.join(folder, 'trace-viewer'))).toEqual(files(INSTALLED_VIEWER));
      expect(settings(folder)['traceViewer']).toBe('trace-viewer');
      expect(warnings(output)).toEqual([]);
    }, 60_000);

    it('judges the viewer on the merging Playwright, not on the version of the blobs', () => {
      // Blobs "recorded" by 1.64.1, merged by a viewer below the minimum: never copied.
      const { folder, output } = merge('merged-below', {
        LOUPE_FIXTURE_PLAYWRIGHT_CORE: standIn('merge-below', '1.60.0', { 'index.html': 'viewer' }),
        LOUPE_FIXTURE_PLAYWRIGHT_VERSION: '1.64.1',
      });
      expect(warnings(output)).toEqual([expect.stringContaining('this is 1.60.0.')]);
      expect(existsSync(path.join(folder, 'trace-viewer'))).toBe(false);
    }, 60_000);

    it('copies with one warning when the blobs are newer than the merging Playwright', () => {
      const { folder, status, output } = merge('merged-older', {
        LOUPE_FIXTURE_PLAYWRIGHT_CORE: standIn('merge-older', '1.62.1', { 'index.html': 'viewer' }),
        LOUPE_FIXTURE_PLAYWRIGHT_VERSION: '1.64.1',
      });
      expect(status, output).toBe(0);
      expect(warnings(output)).toEqual([expect.stringContaining('runs Playwright 1.62.1, older than the 1.64.1')]);
      expect(settings(folder)['traceViewer']).toBe('trace-viewer');
    }, 60_000);

    it('copies without a warning when the version of the blobs cannot be read', () => {
      const { folder, output } = merge('merged-unknown', {
        LOUPE_FIXTURE_PLAYWRIGHT_CORE: standIn('merge-unknown', '1.62.1', { 'index.html': 'viewer' }),
        LOUPE_FIXTURE_PLAYWRIGHT_VERSION: 'unknown',
      });
      expect(warnings(output)).toEqual([]);
      expect(settings(folder)['traceViewer']).toBe('trace-viewer');
    }, 60_000);
  });

  /**
   * The promise of the option. The viewer opens the fixture's trace, whose page
   * holds an `<object>` and an `<embed>` from another host, in a browser whose
   * every request goes through a proxy that records what leaves the report origin.
   * Runs on every CI job from Playwright 1.61, so on the lockfile and latest jobs,
   * and in weekly.yml. Skipped below: the option refuses those viewers.
   */
  describe.runIf(COPIES)(`no request leaves the report origin, from Playwright ${MIN_PLAYWRIGHT_TRACE_VIEWER}`, () => {
    const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.zip': 'application/zip', '.svg': 'image/svg+xml' };
    let site: Server;
    let proxy: Server;
    let origin: string;
    const left: string[] = [];

    const listen = (server: Server): Promise<number> =>
      new Promise((resolve) =>
        server.listen(0, '127.0.0.1', () => {
          const address = server.address();
          resolve(typeof address === 'object' && address ? address.port : 0);
        }),
      );

    beforeAll(async () => {
      site = createServer((req, res) => {
        const file = path.join(bundled.folder, decodeURIComponent(new URL(req.url ?? '/', 'http://site').pathname));
        if (!existsSync(file) || !statSync(file).isFile()) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
        createReadStream(file).pipe(res);
      });
      const sitePort = await listen(site);
      origin = `http://127.0.0.1:${sitePort}`;

      proxy = createServer((req, res) => {
        const url = new URL(req.url ?? '');
        if (url.origin !== origin) {
          left.push(`${req.method} ${url.href}`);
          res.writeHead(502).end();
          return;
        }
        const forward = request({ host: url.hostname, port: url.port, path: url.pathname + url.search, method: req.method, headers: req.headers }, (answer) => {
          res.writeHead(answer.statusCode ?? 502, answer.headers);
          answer.pipe(res);
        });
        forward.on('error', () => res.writeHead(502).end());
        req.pipe(forward);
      });
      proxy.on('connect', (req, socket) => {
        left.push(`CONNECT ${req.url}`);
        socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      });
      await listen(proxy);
    });

    afterAll(() => {
      site?.close();
      proxy?.close();
    });

    it('opens a trace whose page has an object and an embed from another host', async () => {
      const address = proxy.address();
      const browser = await chromium.launch({
        // `<-loopback>`: the report origin goes through the proxy too, so nothing escapes it.
        proxy: { server: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`, bypass: '<-loopback>' },
      });
      try {
        const context = await browser.newContext();
        const control = await context.newPage();
        // The proxy sees what a page sends elsewhere; otherwise an empty record proves nothing.
        await control.goto('https://control.third-party.test/').catch(() => {});
        await control.close();
        const page = await context.newPage();
        await page.goto(`${origin}/index.html`);
        await page.evaluate(() => fetch('http://control.third-party.test/').catch(() => {}));
        expect([...left].sort()).toEqual(['CONNECT control.third-party.test:443', 'GET http://control.third-party.test/']);
        left.length = 0;

        const report = readReport(bundled.folder, bundled.output);
        const trace = report.tests[0]?.attempts[0]?.attachments.find((attachment) => attachment.kind === 'trace')?.path;
        await page.goto(`${origin}/trace-viewer/index.html?trace=${encodeURIComponent(`${origin}/${trace}`)}`);

        // The snapshot must really be on screen, with both elements, or the record below proves nothing.
        await expect.poll(async () => {
          for (const frame of page.frames()) {
            if ((await frame.locator('#marker').count().catch(() => 0)) > 0) return frame.locator('object, embed').count().catch(() => 0);
          }
          return 0;
        }, { timeout: 30_000 }).toBe(2);
        await page.waitForTimeout(1_000);
        expect(left).toEqual([]);
      } finally {
        await browser.close();
      }
    }, 60_000);
  });
});
