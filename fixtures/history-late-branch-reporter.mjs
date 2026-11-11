// Test-only reporter for test/history.integration.test.ts, listed before Loupe
// when LOUPE_FIXTURE_LATE_BRANCH is set. In onEnd, which Playwright calls on
// each reporter in turn, it sets a branch in the run metadata that Loupe's
// onBegin could not see: the report ends in another stream than the one Loupe
// read at the start.
export default class LateBranchReporter {
  onBegin(config) {
    this.config = config;
  }

  onEnd() {
    this.config.metadata.gitCommit = { ...(this.config.metadata.gitCommit ?? {}), branch: process.env.LOUPE_FIXTURE_LATE_BRANCH };
  }
}
