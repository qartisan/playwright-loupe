import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { FullConfig, FullResult, Reporter, Suite, TestError } from '@playwright/test/reporter';
import { loadConfig } from '../config/index.js';
import type { LoupeReporterOptions, ResolvedConfig } from '../config/types.js';
import type { RunScope } from '../schema/v1.js';
import { buildReport } from './build.js';
import { LOCAL_GIT_TIMEOUT_MS, readLocalGit, type LocalGit } from './git.js';
import { injectData, injectSettings, type RendererSettings } from './inject.js';
import { secretValues } from './redact.js';
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
  /** Values of the `redact.env` variables, read once at startup. */
  private readonly secretValues: string[];
  private readonly scopeOverride: RunScope | null;
  /** Playwright passes `_mode: 'merge'` to reporters under `merge-reports` (1.52 and later). */
  private readonly merged: boolean;
  /** Directory of the Playwright config (of the merge config under `merge-reports`). */
  private readonly configDir: string | null;
  private localGit: Promise<LocalGit> | null = null;
  private readonly runErrors: Array<{ error: TestError; project: string | null }> = [];
  private config: FullConfig | undefined;
  private suite: Suite | undefined;
  private runId = '';

  constructor(options: LoupeReporterOptions = {}) {
    // Everything is validated here: an error thrown by the constructor stops the
    // run with its message, which no later reporter hook can do.
    this.scopeOverride = parseScopeOverride(process.env[SCOPE_ENV]);
    // Read before loadConfig() strips Playwright's own keys from the options.
    const raw = options as Record<string, unknown>;
    this.merged = raw['_mode'] === 'merge';
    this.configDir = typeof raw['configDir'] === 'string' ? raw['configDir'] : null;
    this.loupeConfig = loadConfig(options as Record<string, unknown>);
    // After the config is loaded; warnings name a variable, never its value.
    this.secretValues = secretValues(this.loupeConfig.redact.env, process.env, (message) => console.warn(message));
  }

  printsToStdio(): boolean {
    return false;
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.config = config;
    this.suite = suite;
    this.runId = randomUUID();
    // One batch of read-only git commands per run, started now and awaited in onEnd.
    if (this.loupeConfig.git.local) {
      this.localGit = readLocalGit({
        cwd: this.configDir ?? (config.configFile ? path.dirname(config.configFile) : process.cwd()),
        env: process.env,
        timeoutMs: LOCAL_GIT_TIMEOUT_MS,
      });
    }
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
      redact: { mode: this.loupeConfig.redact.mode, patterns: this.loupeConfig.redact.patterns, values: this.secretValues },
      home: homedir(),
      ...(this.localGit ? { localGit: { git: await this.localGit, merged: this.merged } } : {}),
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
