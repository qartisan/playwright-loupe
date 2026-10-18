import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { DEFAULT_RENDERER_SETTINGS, injectData, injectSettings } from './src/core/inject.js';

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

/** Dev server only: injects the sample report and reloads the page when it changes. */
function sampleData(): Plugin {
  return {
    name: 'loupe:sample-data',
    apply: 'serve',
    transformIndexHtml(html) {
      const settings = { ...DEFAULT_RENDERER_SETTINGS, title: 'Loupe sample' };
      return injectSettings(injectData(html, JSON.parse(readFileSync(SAMPLE_JSON, 'utf8'))), settings);
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
