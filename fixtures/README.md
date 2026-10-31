# Fixture suite

This Playwright suite exists to feed the Loupe reporter with realistic results. Run it with `npm run fixtures`; the report lands in `loupe-report/` at the repository root.

**Its failures are intentional and must never be fixed.** It deliberately contains:

- passing tests;
- a failing assertion (`fails on a wrong heading`), and a `toEqual` failure with a multi-line diff (`returns a different order`);
- a flaky test that fails on the first attempt and passes on retry (`testInfo.retry`), with one attachment per attempt;
- a skipped test and a `fixme`, both without a reason;
- skip reasons (`skip reasons` in `outcomes.spec.ts`): a runtime `test.skip(condition, reason)` that skips on `chromium-b` only (it passes on `chromium-a`), a runtime `test.fixme(true, reason)`, and a `describe` skipped by a `test.skip(({ browserName }) => …, reason)` callback;
- a serial group (`test.describe.serial`) whose first test fails on purpose, so Playwright skips the second one without any skip annotation: a test that was not run. From Playwright 1.63, every test of the group also carries Playwright's own `serial` annotation;
- a slow test (about 3 seconds);
- a test timing out while an action is pending (`times out`), so each of its attempts has a second error raised after the test timeout, the one error group only seen after a test timeout;
- one failure per built-in error category: ambiguous locator (a strict mode violation), locator not found, rate limited and server error (a 429 through `toBeOK()` and a 500 through `failOnStatusCode`, both from a local HTTP server on 127.0.0.1), network (a refused connection), assertion and timeout;
- a second `toBeOK()` failure with another status (`is unavailable`, a 503 from the same local server, `Server error`): its signature keeps the response status of the call log, so it is a group of its own, apart from the 429;
- two tests throwing the same error with a different UUID, URL and duration, which must share an error signature (their category is `Uncategorized`);
- five unrelated failures through one shared helper, outside `testDir` (`helpers/resources.ts`: `fetchResource`, which calls `checkResponse`), in three spec files under `tests/resources/`, with two statuses (404, `Uncategorized`, and 503, `Server error`), so two error groups. They are a false common failure point on purpose: the failures have nothing to do with each other, and the report must show exactly one common failure point, `../helpers/resources.ts#fetchResource` via `checkResponse`. That measures the heuristic. `helpers/status-server.ts` holds the local HTTP server shared with `failures.spec.ts`;
- a `toHaveScreenshot` failure producing expected / actual / diff images, against the committed baseline in `tests/__screenshots__/` (a red square; the test renders a blue one);
- nested `describe` blocks, a `test.step` with a nested step, a test failing inside a nested `test.step` (second level, `fails inside a nested step`), and a test writing to stdout and stderr;
- prefixed tags (`@layer:api`, `@layer:ui`, `@area:checkout`), an unprefixed tag (`@smoke`) and a `bug` annotation;
- a screenshot attachment, plus the videos and traces Playwright keeps on failure;
- two passing tests for secret redaction (`redaction.spec.ts`): one fills a field labelled "Password" with an invented value, the other writes the value of `LOUPE_FIXTURE_SECRET` to stdout and into a neutral field. The report must show `[redacted]` and never the values. `redaction-values.ts` holds the invented values and sets `LOUPE_FIXTURE_SECRET` (imported by `playwright.config.ts` and `merge.config.ts`), so a run is self-contained; a real suite takes such values from its environment.

Everything runs offline, through `page.setContent` and local servers on 127.0.0.1. Two Chromium projects (`chromium-a`, `chromium-b`) run the same tests so the report has more than one project. `snapshotPathTemplate` uses one baseline for every project and platform.

`paths/` is a small suite of its own for the paths written in the report (see `test/paths.integration.test.ts`): a failure in a helper outside its `testDir`, missing files under the root dir and in the home directory, an error without frames, and a test printing paths to stdout, an annotation and a text attachment. The test copies it under fake absolute roots; its failures are intentional too. It needs no browser. `paths/roots-reporter.ts`, added when `LOUPE_FIXTURE_ROOTS` is set, writes the roots Loupe derives from the stacks, so the test can check that a direct run derives no root but the root dir.

`merge.config.ts` is the config for `playwright merge-reports` on blob reports of a sharded run (see `test/merge.integration.test.ts`). It uses the same `testDir` so merged paths and test ids match an unsharded run.

## Loupe config

`loupe.config.ts` is picked up by both `playwright.config.ts` and `merge.config.ts` (same directory). It deliberately:

- adds a `Visual regression` category rule (no color, so it gets the first palette color) that wins over the built-in `Assertion` rule for the screenshot comparison failure;
- declares a `Bug` dimension from the `bug` annotation;
- declares a `Layer` dimension for the `layer` tag prefix, replacing the automatic `layer` dimension, with `values: ['api', 'e2e']`: `ui` is used by the suite but missing from the list (an unknown value), and no test uses `e2e`;
- lists `LOUPE_FIXTURE_SECRET` in `redact.env` (a name, never a value);
- sets `title`, which the inline `title` of `playwright.config.ts` overrides, plus `environment`, `theme` and `screenshots.defaultView`.

`invalid.loupe.config.ts` has a typo in a key. The integration tests load it through `LOUPE_CONFIG` to check that the run stops.

## Load error

`load-error.config.ts` runs `load-error/`, where `broken.spec.ts` imports a module that does not exist and `passing.spec.ts` would pass. **The load error is intentional.** Playwright runs no test at all when a file fails to load, so the report has zero tests and the error in `run.errors` (see `test/load-error.integration.test.ts`, which also merges its blob with `merge-reports`). It is kept apart from the main suite so that suite still runs.

## Scope

`scope.config.ts` runs `scope/`, a browserless suite for run scope detection (see `test/scope.integration.test.ts`). **The `test.only` in `scope/focused.spec.ts` is intentional:** a plain run must be `partial` with the `only` reason alone, which checks that Playwright's internal `_only` flag still works. The `main` project depends on `setup`, to check `--project` and `--no-deps`. Other runs of this suite pass a file filter (`plain.spec.ts`) so the `test.only` does not apply. `scope-default.config.ts` runs the same folder without the `test.only` and adds a `nightly` project with `default: false` (Playwright 1.64+).

## Rerun commands

`rerun.config.ts` runs `rerun/`, a browserless suite for the rerun commands (see `test/rerun.integration.test.ts`): titles, tags, paths and project names that are hard to select with `-g` or to paste in a shell. **The odd file names under `rerun/hostile/` are intentional** (without `%`: Playwright itself crashes on it in ES module packages), and so are the pairs of tests in `rerun/twins.spec.ts`, which `-g` cannot tell apart, and the invented secret in the titles of `rerun/redaction.spec.ts`, which the report hides. The paths in the titles of `rerun/paths-in-titles.spec.ts` are rewritten in the report, so their commands are expected to find nothing, or the test with the rewritten title. The test only lists this suite, it never runs it.

## Windows check

`windows-check/` is not a suite of its own: `build.mjs` copies `rerun/` to a folder outside the repository, with `long.spec.ts`, as a CommonJS package (a `%` in a file name crashes Playwright in ES module packages), then generates the commands with the real builder. `check.mjs` runs them in every shell found. `.github/workflows/windows-check.yml` runs it on `windows-latest`; see [Windows job](../docs/releasing.md#windows-job-on-the-rerun-commands). For a manual run on another machine: `npm run build`, then `node fixtures/windows-check/build.mjs <folder> --pack <file.tgz>`, and follow the `README.txt` of the archive.

## Playwright version

`version.config.ts` runs `scope/plain.spec.ts` alone, for the run-time warning below the supported Playwright version (see `test/support.integration.test.ts`). A test-only reporter listed before Loupe, `helpers/playwright-version.ts`, replaces `config.version` with `LOUPE_FIXTURE_PLAYWRIGHT_VERSION`, so the warning is checked on every Playwright version CI runs.

## Playwright internals

`internals.config.ts` runs `scope/` like `scope.config.ts`, its intentional `test.only` included, to check that Loupe still produces its report when the Playwright internals it reads are missing or reshaped (see `test/internals.integration.test.ts`). With `LOUPE_FIXTURE_INTERNALS=missing` or `reshaped`, a test-only reporter listed before Loupe, `helpers/internals.ts`, removes or reshapes `_only`, the internal config under `configInternalSymbol` and `metadata.actualWorkers` just before Loupe reads them, and the config file overrides the `_mode` and `configDir` reporter options.

## Git

`git.config.ts` runs `git/`, a single passing browserless test, for the sources of `run.git` (see `test/git.integration.test.ts`). Playwright's own capture is off unless `LOUPE_FIXTURE_CAPTURE_GIT=commit`, even on CI; `LOUPE_FIXTURE_GIT_COMMIT` puts a commit hash in the metadata, as `metadata.gitCommit`. The test empties the CI variables, so the values come from the metadata or from this repository.

## Renderer sample

`sample.config.ts` runs the same suite with a `globalTeardown` (`sample/global-teardown.ts`) that **fails on purpose**, so the report has a run error. `npm run sample:update` runs it with `--grep-invert "is slow"`, which makes the run partial (and skips the slow test), checks that the report has failed, flaky and skipped tests, a partial scope and a run error, then writes it to `src/renderer/dev/sample.json` for the renderer dev server and the renderer build tests. Its attachment files are copied to `src/renderer/dev/data/`, gitignored (videos and traces would bloat the repository); the dev server serves them at `data/`, like a report folder. It is kept apart from `playwright.config.ts`, whose runs must have no run error.

## Scripts

`npm run sample:update` regenerates the renderer sample (see above).

`npm run fixtures` exits with code 0 when the suite fails in the expected way, and with an error when the reporter did not produce a report, the report has run errors, or the suite unexpectedly passed (see `scripts/run-fixtures.mjs`).
