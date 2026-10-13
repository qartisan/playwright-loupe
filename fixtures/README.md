# Fixture suite

This Playwright suite exists to feed the Loupe reporter with realistic results. Run it with `npm run fixtures`; the report lands in `loupe-report/` at the repository root.

**Its failures are intentional and must never be fixed.** It deliberately contains:

- passing tests;
- a failing assertion (`fails on a wrong heading`);
- a flaky test that fails on the first attempt and passes on retry (`testInfo.retry`), with one attachment per attempt;
- a skipped test and a `fixme`;
- a slow test (about 3 seconds);
- one failure per built-in error category: timeout, locator not found, network (a refused connection) and assertion;
- two tests throwing the same error with a different UUID, URL and duration, which must share an error signature (their category is `Uncategorized`);
- a `toHaveScreenshot` failure producing expected / actual / diff images, against the committed baseline in `tests/__screenshots__/` (a red square; the test renders a blue one);
- nested `describe` blocks, a `test.step` with a nested step, and a test writing to stdout and stderr;
- prefixed tags (`@layer:api`, `@layer:ui`, `@area:checkout`), an unprefixed tag (`@smoke`) and a `bug` annotation;
- a screenshot attachment, plus the videos and traces Playwright keeps on failure.

Everything runs offline through `page.setContent`. Two Chromium projects (`chromium-a`, `chromium-b`) run the same tests so the report has more than one project. `snapshotPathTemplate` uses one baseline for every project and platform.

`merge.config.ts` is the config for `playwright merge-reports` on blob reports of a sharded run (see `test/merge.integration.test.ts`). It uses the same `testDir` so merged paths and test ids match an unsharded run.

## Loupe config

`loupe.config.ts` is picked up by both `playwright.config.ts` and `merge.config.ts` (same directory). It deliberately:

- adds a `Visual regression` category rule (no color, so it gets the first palette color) that wins over the built-in `Assertion` rule for the screenshot comparison failure;
- declares a `Bug` dimension from the `bug` annotation;
- declares a `Layer` dimension for the `layer` tag prefix, replacing the automatic `layer` dimension, with `values: ['api', 'e2e']`: `ui` is used by the suite but missing from the list (an unknown value), and no test uses `e2e`;
- sets `title`, which the inline `title` of `playwright.config.ts` overrides, plus `environment`, `theme` and `screenshots.defaultView`.

`invalid.loupe.config.ts` has a typo in a key. The integration tests load it through `LOUPE_CONFIG` to check that the run stops.

## Load error

`load-error.config.ts` runs `load-error/`, where `broken.spec.ts` imports a module that does not exist and `passing.spec.ts` would pass. **The load error is intentional.** Playwright runs no test at all when a file fails to load, so the report has zero tests and the error in `run.errors` (see `test/load-error.integration.test.ts`, which also merges its blob with `merge-reports`). It is kept apart from the main suite so that suite still runs.

## Scripts

`npm run sample:update` runs the suite and copies its report to `src/renderer/dev/sample.json` for the renderer dev server.

`npm run fixtures` exits with code 0 when the suite fails in the expected way, and with an error when the reporter did not produce a report, the report has run errors, or the suite unexpectedly passed (see `scripts/run-fixtures.mjs`).
