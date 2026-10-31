// Prints the tests a command selects, on one line. As fixtures/helpers/selection-reporter.ts, for a package with no build step.
const path = require('node:path');

class SelectionReporter {
  printsToStdio() {
    return true;
  }

  onBegin(config, suite) {
    const tests = suite.allTests().map((test) => [
      test.parent.project()?.name ?? '',
      path.relative(config.rootDir, test.location.file).split(path.sep).join('/'),
      ...test.titlePath().slice(3),
    ]);
    console.log(`LOUPE_SELECTION ${JSON.stringify(tests)}`);
  }
}

module.exports = SelectionReporter;
