import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { FullConfig, FullResult, Reporter, Suite, TestError } from '@playwright/test/reporter';
import { loadConfig } from '../config/index.js';
import type { LoupeReporterOptions, ResolvedConfig } from '../config/types.js';
import type { RunScope } from '../schema/v1.js';
import type { LoupeReport } from '../schema/v1.js';
import { buildReport } from './build.js';
import { createReplay, readHistory, windowOfStream, type HistoryRead } from './history/read.js';
import { recordRun, reportIdentity, runIdentity, type RecordContext } from './history/record.js';
import { LOCAL_GIT_TIMEOUT_MS, readLocalGit, type LocalGit } from './git.js';
import { injectData, injectSettings, type RendererSettings } from './inject.js';
import { detectGit } from './metadata.js';
import { secretValues } from './redact.js';
import { SCOPE_ENV, parseScopeOverride } from './scope.js';
import { playwrightVersionWarning } from './support.js';
import { TRACE_VIEWER_FOLDER, bundleTraceViewer, findPlaywrightCore } from './traceViewer.js';
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
  /** Playwright passes `_mode: 'list'` under `--list`. */
  private readonly listed: boolean;
  /** Directory of the Playwright config (of the merge config under `merge-reports`). */
  private readonly configDir: string | null;
  private localGit: Promise<LocalGit> | null = null;
  private readonly runErrors: Array<{ error: TestError; project: string | null }> = [];
  private config: FullConfig | undefined;
  private suite: Suite | undefined;
  private runId = '';
  /** The history read started in onBegin, awaited in onEnd; null when history is off or nothing runs. */
  private historyRead: Promise<HistoryRead> | null = null;
  /** The Playwright version warning is written once per reporter, even if `onBegin` runs again. */
  private versionChecked = false;

  constructor(options: LoupeReporterOptions = {}) {
    // Everything is validated here: an error thrown by the constructor stops the
    // run with its message, which no later reporter hook can do.
    this.scopeOverride = parseScopeOverride(process.env[SCOPE_ENV]);
    // Read before loadConfig() strips Playwright's own keys from the options.
    const raw = options as Record<string, unknown>;
    this.merged = raw['_mode'] === 'merge';
    this.listed = raw['_mode'] === 'list';
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
    // Below the supported floor, one line on stderr; the run and the report are unchanged.
    if (!this.versionChecked) {
      this.versionChecked = true;
      const warning = playwrightVersionWarning(config.version);
      if (warning) console.warn(warning);
    }
    // One batch of read-only git commands per run, started now and awaited in onEnd.
    if (this.loupeConfig.git.local) {
      this.localGit = readLocalGit({
        cwd: this.projectDir(config),
        env: process.env,
        timeoutMs: LOCAL_GIT_TIMEOUT_MS,
      });
    }
    // The window is read while the tests run. Under --list nothing is recorded or shown.
    this.historyRead = this.loupeConfig.history.enabled && !this.listed ? this.startHistoryRead(config) : null;
  }

  /** What every history step needs, from the run's config and process. */
  private historyContext(config: FullConfig): RecordContext {
    return {
      history: this.loupeConfig.history,
      list: this.listed,
      merged: this.merged,
      reporters: config.reporter.map(([name]) => name),
      env: process.env,
      argv: process.argv,
      configArgv: (config as { argv?: string[] }).argv,
      redact: { mode: this.loupeConfig.redact.mode, patterns: this.loupeConfig.redact.patterns, values: this.secretValues },
      home: homedir(),
    };
  }

  /** Reads the window of the run's stream. Never rejects: a failure is a problem of the result. */
  private async startHistoryRead(config: FullConfig): Promise<HistoryRead> {
    const context = this.historyContext(config);
    let stream = '';
    try {
      // The branch, when it is part of the key, as the report will have it (the report may still differ: onEnd checks).
      const branch = context.history.stream.key.includes('branch')
        ? detectGit(config.metadata, process.env, this.localGit ? { git: await this.localGit, merged: this.merged } : undefined).branch
        : null;
      stream = runIdentity({ ...context, environmentName: this.loupeConfig.environment?.trim() || null, branch }).streamHash;
      return await this.readStream(context, stream);
    } catch (error) {
      return { stream, runs: [], others: [], problems: [`the history could not be read (${error instanceof Error ? error.message : String(error)})`] };
    }
  }

  private readStream(context: RecordContext, stream: string): Promise<HistoryRead> {
    return readHistory(context.history.dir, stream, createReplay(context.redact, context.home));
  }

  private projectDir(config: FullConfig): string {
    return this.configDir ?? (config.configFile ? path.dirname(config.configFile) : process.cwd());
  }

  /** Errors outside tests: load errors, global setup / teardown, worker teardown. Playwright passes `workerInfo` from 1.60; before, run errors have no project. */
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
    // The window of the stream the report belongs to; read again if the stream guessed at the start was not it.
    const history = await this.finishHistoryRead(report, this.config);
    // No copy without a trace. buildReport has removed the viewer of a previous report.
    const hasTrace = report.tests.some((test) => test.attempts.some((attempt) => attempt.attachments.some((attachment) => attachment.kind === 'trace' && attachment.path !== null)));
    const viewer =
      this.loupeConfig.traceViewer === 'bundled' && hasTrace
        ? await bundleTraceViewer({ outputFolder, core: findPlaywrightCore(this.projectDir(this.config)), blobVersion: this.merged ? this.config.version : null })
        : { copied: false, warning: null };
    if (viewer.warning) console.warn(viewer.warning);
    const settings: RendererSettings = {
      title: this.loupeConfig.title,
      theme: this.loupeConfig.theme,
      screenshots: { defaultView: this.loupeConfig.screenshots.defaultView },
      aiPrompt: { includeStack: this.loupeConfig.aiPrompt.includeStack },
      traceViewer: viewer.copied ? TRACE_VIEWER_FOLDER : null,
    };
    const template = await readFile(TEMPLATE_URL, 'utf8');

    await mkdir(outputFolder, { recursive: true });
    await writeFile(path.join(outputFolder, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(path.join(outputFolder, 'index.html'), injectSettings(injectData(template, report), settings));
    // After the report: history never stops a run nor prevents the report.
    await this.recordHistory(report, this.config, history?.problems ?? []);

    const errors = report.run.errors.length;
    const suffix = errors > 0 ? ` (${errors} run error${errors > 1 ? 's' : ''} outside tests)` : '';
    console.log(`\nLoupe report written to ${path.relative(process.cwd(), outputFolder) || '.'}${suffix}`);
  }

  private async finishHistoryRead(report: LoupeReport, config: FullConfig): Promise<HistoryRead | null> {
    if (!this.historyRead) return null;
    const read = await this.historyRead;
    const context = this.historyContext(config);
    try {
      return await windowOfStream(read, reportIdentity(report, context).streamHash, (stream) => this.readStream(context, stream));
    } catch (error) {
      return { ...read, runs: [], others: [], problems: [...read.problems, `the history could not be read (${error instanceof Error ? error.message : String(error)})`] };
    }
  }

  /**
   * Writes the run file and applies the retention. Every history problem of
   * the run, read included, becomes one warning: the report is already written.
   */
  private async recordHistory(report: LoupeReport, config: FullConfig, readProblems: readonly string[]): Promise<void> {
    if (!this.loupeConfig.history.enabled) return;
    const problems = [...readProblems];
    const text = (error: unknown) => (error instanceof Error ? error.message : String(error));
    try {
      const result = await recordRun(report, this.historyContext(config));
      if ('file' in result && result.pruneError !== null) problems.push(`old runs were not removed (${text(result.pruneError)})`);
    } catch (error) {
      problems.push(`this run was not recorded (${text(error)})`);
    }
    if (problems.length > 0) console.warn(`Loupe: history: ${problems.join('; ')}. The report is not affected.`);
  }
}
