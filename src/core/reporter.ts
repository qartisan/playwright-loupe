import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import type { LoupeConfig } from '../config/index.js';
import { injectData } from './inject.js';
import type { PlaceholderReport, PlaceholderTest, PlaceholderTestStatus } from './model.js';

const DEFAULT_OUTPUT_FOLDER = 'loupe-report';
const DEFAULT_TITLE = 'Loupe report';

/** Built renderer template, shipped next to the compiled core (`dist/renderer/index.html`). */
const TEMPLATE_URL = new URL('../renderer/index.html', import.meta.url);

const OUTCOME_TO_STATUS: Record<ReturnType<TestCase['outcome']>, PlaceholderTestStatus> = {
  expected: 'passed',
  unexpected: 'failed',
  flaky: 'flaky',
  skipped: 'skipped',
};

export class LoupeReporter implements Reporter {
  private readonly options: LoupeConfig;
  private config: FullConfig | undefined;
  private suite: Suite | undefined;
  private readonly attempts = new Map<TestCase, number>();

  constructor(options: LoupeConfig = {}) {
    this.options = options;
  }

  printsToStdio(): boolean {
    return false;
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.config = config;
    this.suite = suite;
  }

  onTestEnd(test: TestCase, _result: TestResult): void {
    this.attempts.set(test, (this.attempts.get(test) ?? 0) + 1);
  }

  async onEnd(result: FullResult): Promise<void> {
    if (!this.config || !this.suite) return;

    const outputFolder = this.resolveOutputFolder(this.config);
    const report = this.buildReport(this.config, this.suite, result);
    const template = await readFile(TEMPLATE_URL, 'utf8');

    await mkdir(outputFolder, { recursive: true });
    await writeFile(path.join(outputFolder, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(path.join(outputFolder, 'index.html'), injectData(template, report));

    console.log(`\nLoupe report written to ${path.relative(process.cwd(), outputFolder) || '.'}`);
  }

  private resolveOutputFolder(config: FullConfig): string {
    const base = config.configFile ? path.dirname(config.configFile) : config.rootDir;
    return path.resolve(base, this.options.outputFolder ?? DEFAULT_OUTPUT_FOLDER);
  }

  // Placeholder model (schemaVersion 0) — replaced by schema v1 in the next brief.
  private buildReport(config: FullConfig, suite: Suite, result: FullResult): PlaceholderReport {
    const tests = suite.allTests().map((test): PlaceholderTest => ({
      // titlePath() is ['', project, file, ...describes, title].
      titlePath: test.titlePath().slice(3),
      project: test.parent.project()?.name ?? '',
      file: path.relative(config.rootDir, test.location.file).split(path.sep).join('/'),
      status: OUTCOME_TO_STATUS[test.outcome()],
      attempts: this.attempts.get(test) ?? 0,
    }));

    return {
      schemaVersion: 0,
      run: {
        title: this.options.title ?? DEFAULT_TITLE,
        startTime: result.startTime.toISOString(),
        duration: Math.round(result.duration),
        playwrightVersion: config.version,
        status: result.status,
      },
      tests,
    };
  }
}
