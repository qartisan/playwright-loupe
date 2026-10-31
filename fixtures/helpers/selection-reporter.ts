import path from 'node:path';
import type { FullConfig, Reporter, Suite } from '@playwright/test/reporter';

/**
 * Prints the tests a command selects, for test/rerun.integration.test.ts: with
 * `--list`, on one line, as `[project, file, ...describes, title]`.
 */
export default class SelectionReporter implements Reporter {
  printsToStdio(): boolean {
    return true;
  }

  onBegin(config: FullConfig, suite: Suite): void {
    const tests = suite.allTests().map((test) => [
      test.parent.project()?.name ?? '',
      path.relative(config.rootDir, test.location.file).split(path.sep).join('/'),
      ...test.titlePath().slice(3),
    ]);
    console.log(`LOUPE_SELECTION ${JSON.stringify(tests)}`);
  }
}
