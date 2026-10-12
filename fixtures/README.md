# Fixture suite

This Playwright suite exists to feed the Loupe reporter with realistic results. Run it with `npm run fixtures`; the report lands in `loupe-report/` at the repository root.

**Its failures are intentional and must never be fixed.** It deliberately contains:

- passing tests;
- a failing assertion (`fails on a wrong heading`);
- a flaky test that fails on the first attempt and passes on retry (`testInfo.retry`);
- a skipped test and a `fixme`;
- a slow test (about 3 seconds);
- prefixed tags (`@layer:api`, `@layer:ui`) and a `bug` annotation;
- a screenshot attachment, plus the videos and traces Playwright keeps on failure.

Everything runs offline through `page.setContent`. Two Chromium projects (`chromium-a`, `chromium-b`) run the same tests so the report has more than one project.

`npm run fixtures` exits with code 0 when the suite fails in the expected way, and with an error when the reporter did not produce a report or the suite unexpectedly passed (see `scripts/run-fixtures.mjs`).
