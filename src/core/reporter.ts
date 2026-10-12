import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FullConfig, FullResult, Reporter, Suite } from '@playwright/test/reporter';
import type { LoupeConfig } from '../config/index.js';
import type { RunScope } from '../schema/v1.js';
import { buildReport } from './build.js';
import { injectData, injectOptions, type RenderOptions } from './inject.js';
import { SCOPE_ENV, parseScopeOverride } from './scope.js';
import { generatorVersion } from './version.js';

const DEFAULT_OUTPUT_FOLDER = 'loupe-report';
const DEFAULT_TITLE = 'Loupe report';

/** Built renderer template, shipped next to the compiled core (`dist/renderer/index.html`). */
const TEMPLATE_URL = new URL('../renderer/index.html', import.meta.url);

export class LoupeReporter implements Reporter {
  private readonly options: LoupeConfig;
  private readonly scopeOverride: RunScope | null;
  private config: FullConfig | undefined;
  private suite: Suite | undefined;
  private runId = '';

  constructor(options: LoupeConfig = {}) {
    this.options = options;
    // Validated here so an invalid value stops the run with an explicit message.
    this.scopeOverride = parseScopeOverride(process.env[SCOPE_ENV]);
  }

  printsToStdio(): boolean {
    return false;
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.config = config;
    this.suite = suite;
    this.runId = randomUUID();
  }

  async onEnd(result: FullResult): Promise<void> {
    if (!this.config || !this.suite) return;

    const outputFolder = this.resolveOutputFolder(this.config);
    const report = await buildReport(this.config, this.suite, result, {
      runId: this.runId,
      generatorVersion: await generatorVersion(),
      outputFolder,
      env: process.env,
      scopeOverride: this.scopeOverride,
    });
    const renderOptions: RenderOptions = { title: this.options.title ?? DEFAULT_TITLE };
    const template = await readFile(TEMPLATE_URL, 'utf8');

    await mkdir(outputFolder, { recursive: true });
    await writeFile(path.join(outputFolder, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(path.join(outputFolder, 'index.html'), injectOptions(injectData(template, report), renderOptions));

    console.log(`\nLoupe report written to ${path.relative(process.cwd(), outputFolder) || '.'}`);
  }

  private resolveOutputFolder(config: FullConfig): string {
    const base = config.configFile ? path.dirname(config.configFile) : config.rootDir;
    return path.resolve(base, this.options.outputFolder ?? DEFAULT_OUTPUT_FOLDER);
  }
}
