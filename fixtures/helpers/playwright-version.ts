import type { FullConfig, Reporter } from '@playwright/test/reporter';

/**
 * Test-only reporter, listed before Loupe in `version.config.ts`: replaces
 * `config.version` with `LOUPE_FIXTURE_PLAYWRIGHT_VERSION` when it is set.
 * Playwright passes the same config object to every reporter, in order, so
 * Loupe sees the replaced version.
 */
export default class PlaywrightVersion implements Reporter {
  onBegin(config: FullConfig): void {
    const version = process.env['LOUPE_FIXTURE_PLAYWRIGHT_VERSION'];
    if (version !== undefined) (config as { version: string }).version = version;
  }

  printsToStdio(): boolean {
    return false;
  }
}
