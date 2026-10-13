import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { DEFAULT_RENDERER_SETTINGS, injectData, injectSettings } from './src/core/inject.js';

const SAMPLE_JSON = fileURLToPath(new URL('./src/renderer/dev/sample.json', import.meta.url));

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
  };
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
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    assetsInlineLimit: Number.POSITIVE_INFINITY,
    cssCodeSplit: false,
    modulePreload: false,
  },
});
