import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FullConfig, FullResult, Reporter, Suite, TestError } from '@playwright/test/reporter';
import { loadConfig } from '../config/index.js';
import type { LoupeReporterOptions, ResolvedConfig } from '../config/types.js';
import type { RunScope } from '../schema/v1.js';
import { buildReport } from './build.js';
import { injectData, injectSettings, type RendererSettings } from './inject.js';
import { SCOPE_ENV, parseScopeOverride } from './scope.js';
import { generatorVersion } from './version.js';

/**
 * The part of `onError`'s second argument Loupe reads. Declared here because
 * `@playwright/test/reporter` only exports `WorkerInfo` in recent versions.
 */
interface ErrorWorkerInfo {
  project: { name: string };
}

/** Built renderer template, shipped next to the compiled core (`dist/renderer/index.html`). */
const TEMPLATE_URL = new URL('../renderer/index.html', import.meta.url);

export class LoupeReporter implements Reporter {
  private readonly loupeConfig: ResolvedConfig;
  private readonly scopeOverride: RunScope | null;
  private readonly runErrors: Array<{ error: TestError; project: string | null }> = [];
  private config: FullConfig | undefined;
  private suite: Suite | undefined;
  private runId = '';

  constructor(options: LoupeReporterOptions = {}) {
    // Everything is validated here: an error thrown by the constructor stops the
    // run with its message, which no later reporter hook can do.
    this.scopeOverride = parseScopeOverride(process.env[SCOPE_ENV]);
    this.loupeConfig = loadConfig(options as Record<string, unknown>);
  }

  printsToStdio(): boolean {
    return false;
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.config = config;
    this.suite = suite;
    this.runId = randomUUID();
  }

  /** Errors outside tests: load errors, global setup / teardown, worker teardown. Playwright 1.52 does not pass `workerInfo`; recent versions do. */
  onError(error: TestError, workerInfo?: ErrorWorkerInfo): void {
    this.runErrors.push({ error, project: workerInfo?.project.name ?? null });
  }

  async onEnd(result: FullResult): Promise<void> {
    if (!this.config || !this.suite) return;

    const { outputFolder } = this.loupeConfig;
    const report = await buildReport(this.config, this.suite, result, {
      runId: this.runId,
      generatorVersion: await generatorVersion(),
      outputFolder,
      env: process.env,
      scopeOverride: this.scopeOverride,
      environmentName: this.loupeConfig.environment,
      categories: this.loupeConfig.categories,
      dimensions: this.loupeConfig.dimensions,
      runErrors: this.runErrors,
    });
    const settings: RendererSettings = {
      title: this.loupeConfig.title,
      theme: this.loupeConfig.theme,
      screenshots: { defaultView: this.loupeConfig.screenshots.defaultView },
      aiPrompt: { includeStack: this.loupeConfig.aiPrompt.includeStack },
    };
    const template = await readFile(TEMPLATE_URL, 'utf8');

    await mkdir(outputFolder, { recursive: true });
    await writeFile(path.join(outputFolder, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(path.join(outputFolder, 'index.html'), injectSettings(injectData(template, report), settings));

    const errors = report.run.errors.length;
    const suffix = errors > 0 ? ` (${errors} run error${errors > 1 ? 's' : ''} outside tests)` : '';
    console.log(`\nLoupe report written to ${path.relative(process.cwd(), outputFolder) || '.'}${suffix}`);
  }
}
