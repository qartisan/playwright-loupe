import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { DEFAULT_RENDERER_SETTINGS, injectData, injectHistory, injectSettings } from './src/core/inject.js';
import type { LoupeReport } from './src/schema/v1.js';
import { HISTORY_SCENARIOS, SCENARIO_HELP, historyScenario, type HistoryScenario } from './test/helpers/history-scenarios.js';

const SAMPLE_JSON = fileURLToPath(new URL('./src/renderer/dev/sample.json', import.meta.url));
/** The sample's attachment files, copied by `npm run sample:update` (gitignored). */
const SAMPLE_DATA = fileURLToPath(new URL('./src/renderer/dev/data/', import.meta.url));

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webm': 'video/webm',
  '.zip': 'application/zip',
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/** Size budget of the built renderer, gzipped: a warning above the first, a failed build above the second. */
const BUDGET_WARN_BYTES = 100_000;
const BUDGET_FAIL_BYTES = 150_000;

/** Embedded fonts (data URIs), to report the size without them. */
const EMBEDDED_FONT = /url\(["']?data:font\/woff2;base64,[A-Za-z0-9+/=]+["']?\)/g;

/**
 * Inlines the built JS and CSS into index.html so the renderer ships as one
 * self-contained file the reporter can fill with data and write anywhere.
 */
function inlineAssets(): Plugin {
  return {
    name: 'loupe:inline-assets',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = bundle['index.html'];
      if (!html || html.type !== 'asset') return;
      let source = String(html.source);

      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type === 'chunk') {
          const tag = new RegExp(`<script[^>]*src="[^"]*${escapeRegExp(fileName)}"[^>]*></script>`);
          const code = output.code.replace(/<\/script/gi, '<\\/script');
          source = source.replace(tag, () => `<script type="module">${code}</script>`);
          delete bundle[fileName];
        } else if (fileName.endsWith('.css')) {
          const tag = new RegExp(`<link[^>]*href="[^"]*${escapeRegExp(fileName)}"[^>]*>`);
          source = source.replace(tag, () => `<style>${String(output.source)}</style>`);
          delete bundle[fileName];
        }
      }
      html.source = source;
    },
    writeBundle(options, bundle) {
      const html = bundle['index.html'];
      if (!html || html.type !== 'asset') return;
      const others = Object.keys(bundle).filter((fileName) => fileName !== 'index.html');
      if (others.length > 0) this.error(`the renderer must build to index.html alone, got also: ${others.join(', ')}`);
      const source = String(html.source);
      const bytes = Buffer.byteLength(source);
      const gzip = gzipSync(source).byteLength;
      const gzipWithoutFonts = gzipSync(source.replace(EMBEDDED_FONT, 'url()')).byteLength;
      this.info(
        `renderer bundle: ${path.relative(process.cwd(), path.join(options.dir ?? '', 'index.html'))}, ${formatKb(bytes)} ` +
          `(gzip ${formatKb(gzip)}; without fonts ${formatKb(gzipWithoutFonts)}, fonts ${formatKb(gzip - gzipWithoutFonts)}), JS, CSS and fonts inlined`,
      );
      const budget = `budget: warning above ${formatKb(BUDGET_WARN_BYTES)}, failure above ${formatKb(BUDGET_FAIL_BYTES)} gzip`;
      if (gzip > BUDGET_FAIL_BYTES) this.error(`the renderer is ${formatKb(gzip)} gzip, over its size ${budget}`);
      if (gzip > BUDGET_WARN_BYTES) this.warn(`the renderer is ${formatKb(gzip)} gzip, close to its size ${budget}`);
    },
  };
}

function formatKb(bytes: number): string {
  return `${(bytes / 1000).toFixed(1)} kB`;
}

/**
 * The history scenario of a dev page: `?history=<name>` before the hash
 * (`http://localhost:5173/?history=normal#/`). None by default: no history.
 */
function scenarioOf(url: string | undefined, warn: (message: string) => void): HistoryScenario {
  const name = new URL(url ?? '/', 'http://localhost').searchParams.get('history');
  if (name === null) return 'none';
  if ((HISTORY_SCENARIOS as readonly string[]).includes(name)) return name as HistoryScenario;
  warn(`loupe: unknown history scenario "${name}"; one of:\n${HISTORY_SCENARIOS.map((scenario) => `  ${scenario}: ${SCENARIO_HELP[scenario]}`).join('\n')}`);
  return 'none';
}

/** Dev server only: injects the sample report, and a history scenario, and reloads the page when the sample changes. */
function sampleData(): Plugin {
  let warn: (message: string) => void = console.warn;
  return {
    name: 'loupe:sample-data',
    apply: 'serve',
    configResolved(config) {
      warn = (message) => config.logger.warn(message);
    },
    transformIndexHtml(html, context) {
      const settings = { ...DEFAULT_RENDERER_SETTINGS, title: 'Loupe sample' };
      const sample = JSON.parse(readFileSync(SAMPLE_JSON, 'utf8')) as LoupeReport;
      // Built with the real deriveEmbedded, in Node: the renderer itself never imports src/core.
      const { report, history } = historyScenario(scenarioOf(context.originalUrl, warn), sample);
      return injectHistory(injectSettings(injectData(html, report), settings), history);
    },
    configureServer(server) {
      // Attachment links are relative to the report folder (`data/<test>/<attempt>/<file>`): serve the sample's copy there.
      server.middlewares.use('/data/', (request, response, next) => {
        let file: string;
        try {
          file = path.resolve(SAMPLE_DATA, decodeURIComponent((request.url ?? '').split('?')[0] ?? '').replace(/^\/+/, ''));
        } catch {
          return next();
        }
        if (!file.startsWith(SAMPLE_DATA) || !existsSync(file) || !statSync(file).isFile()) return next();
        response.setHeader('Content-Type', CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
        createReadStream(file).pipe(response);
      });
      server.watcher.add(SAMPLE_JSON);
      server.watcher.on('change', (file) => {
        if (file === SAMPLE_JSON) server.ws.send({ type: 'full-reload' });
      });
    },
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [sampleData(), inlineAssets()],
  // Preact's automatic JSX runtime (no React, no extra plugin).
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    assetsInlineLimit: Number.POSITIVE_INFINITY,
    cssCodeSplit: false,
    modulePreload: false,
  },
});
