import { createRequire } from 'node:module';
import path from 'node:path';
import type { Reporter } from '@playwright/test/reporter';

const require = createRequire(import.meta.url);

/**
 * Test-only reporter, listed before Loupe: when `LOUPE_FIXTURE_PLAYWRIGHT_CORE`
 * is set, the modules of `playwright-core` pass for modules of that folder when
 * Loupe looks for them. Done in `onEnd`, which Playwright runs reporter by
 * reporter, so that the run itself keeps its real modules.
 */
export default class PlaywrightCoreStandIn implements Reporter {
  onEnd(): void {
    const folder = process.env['LOUPE_FIXTURE_PLAYWRIGHT_CORE'];
    if (folder === undefined) return;
    for (const file of Object.keys(require.cache)) {
      if (!/[\\/]playwright-core[\\/]/.test(file)) continue;
      const loaded = require.cache[file];
      delete require.cache[file];
      if (loaded) require.cache[path.join(folder, 'index.js')] = loaded;
    }
  }

  printsToStdio(): boolean {
    return false;
  }
}
