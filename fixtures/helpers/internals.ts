import type { FullConfig, Reporter, Suite } from '@playwright/test/reporter';

/**
 * Test-only reporter, listed before Loupe in `internals.config.ts`: with
 * `LOUPE_FIXTURE_INTERNALS=missing` or `reshaped`, it removes or reshapes the
 * Playwright internals Loupe reads in `onEnd` (`_only`, the internal config
 * under `configInternalSymbol`, `metadata.actualWorkers`). Playwright calls
 * `onEnd` reporter by reporter, in order, on the same objects, so Loupe sees
 * the change. The reporter options (`_mode`, `configDir`) are changed in the
 * config file instead.
 */
export default class Internals implements Reporter {
  private config: FullConfig | undefined;
  private suite: Suite | undefined;

  onBegin(config: FullConfig, suite: Suite): void {
    this.config = config;
    this.suite = suite;
  }

  onEnd(): void {
    const scenario = process.env['LOUPE_FIXTURE_INTERNALS'];
    if (!this.config || !this.suite || (scenario !== 'missing' && scenario !== 'reshaped')) return;
    const missing = scenario === 'missing';

    const nodes: object[] = [];
    const visit = (suite: Suite): void => {
      nodes.push(suite, ...suite.tests);
      suite.suites.forEach(visit);
    };
    visit(this.suite);
    for (const node of nodes) {
      if (missing) delete (node as { _only?: unknown })._only;
      else (node as { _only?: unknown })._only = 'yes';
    }

    const config = this.config as unknown as Record<symbol, unknown>;
    const symbol = Object.getOwnPropertySymbols(config).find((candidate) => candidate.description === 'configInternalSymbol');
    if (symbol && missing) delete config[symbol];
    else if (symbol) config[symbol] = { projects: [null, 42, { default: 'no', project: null }] };

    const metadata = this.config.metadata as Record<string, unknown>;
    if (missing) delete metadata['actualWorkers'];
    else metadata['actualWorkers'] = 'four';
  }

  printsToStdio(): boolean {
    return false;
  }
}
