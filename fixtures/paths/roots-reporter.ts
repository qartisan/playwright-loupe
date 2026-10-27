import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FullConfig, Reporter, Suite, TestStep } from '@playwright/test/reporter';

// Writes the roots Loupe derives from the stacks of the run (`derivedRoots`
// of src/core/build.ts, imported from the build in LOUPE_FIXTURE_BUILD) to
// the JSON file LOUPE_FIXTURE_ROOTS, with the root dir. In a direct run they
// must all be the root dir (test/paths.integration.test.ts).

type Build = typeof import('../../src/core/build.js');

function stepStacks(steps: readonly TestStep[]): string[] {
  return steps.flatMap((step) => [...(step.error?.stack ? [step.error.stack] : []), ...stepStacks(step.steps)]);
}

export default class RootsReporter implements Reporter {
  private config: FullConfig | undefined;
  private suite: Suite | undefined;

  onBegin(config: FullConfig, suite: Suite): void {
    this.config = config;
    this.suite = suite;
  }

  async onEnd(): Promise<void> {
    if (!this.config || !this.suite) return;
    const { derivedRoots } = (await import(pathToFileURL(process.env['LOUPE_FIXTURE_BUILD'] as string).href)) as Build;
    const rootDir = this.config.rootDir;
    const sources = this.suite.allTests().map((test) => ({
      file: path.relative(rootDir, test.location.file).split(path.sep).join('/'),
      stacks: test.results.flatMap((result) => [...result.errors.flatMap((error) => (error.stack ? [error.stack] : [])), ...stepStacks(result.steps)]),
    }));
    writeFileSync(process.env['LOUPE_FIXTURE_ROOTS'] as string, JSON.stringify({ rootDir, roots: derivedRoots(sources, rootDir) }));
  }
}
