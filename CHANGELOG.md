# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0, minor versions may contain breaking changes. The JSON report has its own version (`schemaVersion`), see [`docs/schema/v1.md`](docs/schema/v1.md#versioning-policy).

## [0.0.4] - 2026-10-17

### Added

- **Filters, synced with the URL.** One filter state for the whole report, in the hash fragment, so a filtered view can be shared, bookmarked or reloaded, from `file://` too: `#/tests?q=login&status=failed,flaky&project=chromium&tag=@smoke&dim.Layer=api&category=Network&sort=duration:desc`. Values of a filter are combined with OR, filters with AND; the search matches every word, ignoring case and accents, in the title path, file and project. Unknown parameters or values are dropped and the URL rewritten in a single canonical form. Clicked filters add a history entry, so Back undoes them; typing in the search does not. The overview, errors and suite health views stay summaries of the whole run; the sidebar follows the filters. The error category filter uses every category of a test's failing attempts, the same definition as the dashboard counts.
- **Tests view** (`#/tests`), a new sidebar entry: every test in one flat list (status, title path, project, file, duration, error categories, attempts), sortable by column (failed, flaky, passed, skipped by default). A filter bar with one menu per facet (status, error category, project, tag, then each dimension in config order; the URL parameter of the error category is `category`), each value with the number of tests it would give; active filters as removable chips, "Clear all", an empty state with a reset button, and a result count announced to screen readers. The error category column shows the test's category (first error of its last failing attempt) and `+N` when its failing attempts had others, listed in the tooltip and the accessible name. The list renders its first 500 rows after filtering and sorting (`Showing 500 of 4,200 tests`), with "Show 500 more" and "Show all"; any filter or sort change starts again from 500, which keeps interactions fast on runs of several thousand tests. Projects without a name cannot be filtered: an empty name cannot be written in the URL. A tag a dimension is built from (`@layer:ui` with a `layer` dimension, configured or automatic) is filtered through that dimension only, not in the tag facet, which is hidden when no tag is left; such a `tag=` value is dropped from the URL. The JSON keeps every raw tag.
- **Search in the sidebar**, always visible: `/` focuses it, Escape clears it. When filters are active, a line shows how many and how many tests match, with a link to the Tests view and "Clear". The tree is reduced to the matching tests and opens fully when they are few.
- **Links to filtered tests.** Header counts (`20 failed` → `#/tests?status=failed`, replacing the current filters), overview error categories (`#/tests?category=…`, the uncategorized bucket included; they used to open the category in the Errors view, which `#/errors/category/<name>` still does) and suite health dimension values in bars, tiles and tables (`#/tests?dim.<name>=<value>`).
- **Run start in the header**, in the viewer's time zone with the zone written out, then the duration (`16 Oct 2026, 14:58 CEST · 5.9 s`). Hover or keyboard focus shows the full date with seconds, the IANA time zone and the UTC timestamp. Hidden when `startedAt` is missing or invalid.

### Changed

- **Sidebar grouped by folder:** projects → folders → files → `describe` blocks → tests. The directory prefix shared by every file (`tests/e2e/`) is left out of the tree and shown once above it; a folder with a single subfolder is shown on one line (`api/users`). Long file names are cut in the middle, keeping their start and extension; the full path is in the tooltip and the accessible name.

## [0.0.3] - 2026-10-16

### Added

- **HTML report application shell.** The renderer is rebuilt with Preact and `@preact/signals`, still one self-contained `index.html` that works from `file://` (both libraries are bundled into it: the package keeps zero runtime dependencies).
  - Header with the run summary: status, counts per outcome, duration, branch, commit and environment. A partial run shows a banner with the reasons it was detected.
  - Collapsible sidebar with a test tree: projects → files → describe blocks → tests, single-child levels merged, a status icon per test (passed, failed, flaky, skipped) and failure counts per node. Keyboard navigation (arrows, Home / End, Enter), the current test highlighted and revealed. Collapsed nodes are not rendered, so large suites stay responsive.
  - Hash routes that work from `file://`: `#/` (overview), `#/errors`, `#/health`, `#/group/<signature>`, `#/test/<id>`. The URL is the single source of navigation state.
  - Light and dark themes: the system theme by default, or the `theme` option; the viewer's choice is remembered in the browser when storage is available.
  - The test page is a placeholder for now.
- **Dashboard, in three views** reached from fixed sidebar entries. Widgets with nothing to show are hidden, except the verdict.
  - **Overview** (`#/`): the verdict (failed, flaky or passed, a stacked bar of the outcomes with their counts, pass rate and duration; a run with run errors is never green), run errors when there are any, compact error categories (one bar per category, each opening that category in the Errors view, `#/errors/category/<name>`), and project cards (counts, pass rate, test time; a click reveals the project in the sidebar).
  - **Pass rate**, one definition everywhere: passed / (total − skipped), labeled "pass rate", with a tooltip saying skipped tests are excluded.
  - **Errors** (`#/errors`): run errors, every error group (most failed tests first, then most flaky), and the categories in detail, each expanding to its groups. Error groups are listed here only. The sidebar entry shows a warning marker and the count when the run has run errors. The former `#/run-errors` route redirects here.
  - **Suite health** (`#/health`): one widget per dimension. Up to 8 values, one stacked bar per value (passed / failed / flaky / skipped) with the total; more values, a grid of tiles colored by worst status with its icon, problem values first, details on hover and keyboard focus, and a summary line (`38 values · 36 all passed · 2 with failures`). The exact table expands from every dimension widget. Tag hygiene: values outside the declared ones and values differing only by case (`API` / `api`) are flagged, never merged; a hint points to `values` when a dimension declares none. Then the ten slowest tests, the flaky tests with the error of their failing attempt, and the skipped tests with their reason.
  - An error group row shows its category, its failed / flaky split, the first affected test (`+N others`) and the line that tells the error apart: the `Locator:` line or the HTTP response status rather than a generic `expect(locator).toBeVisible() failed`.
- **Error group pages** (`#/group/<signature>`): category, signature, failed / flaky split, a full sample message and every affected test with the attempts where the error occurred. Groups are computed in the renderer from the existing report data.
- **Visual identity.** New light and dark palettes, "Loupe" wordmark in the header, a "Loupe — a reporter for Playwright" footer with the version, and DM Sans (regular and semibold, latin) embedded in the HTML so the report keeps working offline. The font is under the SIL Open Font License, shipped in `licenses/DM-Sans-OFL.txt`. Contrast (4.5:1 for text, 3:1 for borders and icons) is checked by the test suite in both themes. The HTML report is about 52 kB gzip, 29 kB of which are the fonts.
- **Category colors from a palette.** `categories.rules[].color` now also accepts a palette name: `blue`, `cyan`, `teal`, `violet`, `magenta`, `orange`, `brown`, `gold` (see [Category palette](docs/config.md#category-palette)). An unknown name is a config error listing the valid names. `#rrggbb` colors still work; the HTML report derives light and dark shades from them that meet the contrast rules.

### Changed

- **Error signatures change again: failures are grouped differently from 0.0.2.** The signature now uses only the stable part of Playwright messages. A strict mode violation loses its element list and count (`resolved to <n> elements`), so a test and its retry get the same signature when the page gained an item between attempts (`.first()` vs `.nth(1)`, `li:nth-child(13)` vs `14`). A locator assertion keeps only its `Error:` lines, `Locator:`, and `Expected…:` / `Received…:` lines: the timeout and screenshot pixel counts no longer count. Different locators, actions or expected values still give different signatures. The call log, stack and code frame were already left out. The JSON shape is unchanged: `schemaVersion` stays `1`. See [Error signature](docs/schema/v1.md#error-signature).
- **Built-in category colors changed** to the new palette, without reds or greens and with no two alike (they were near-duplicate indigos, and Assertion was red like a failure): Ambiguous locator violet `#8656b7`, Locator not found magenta `#ad4681`, Rate limited teal `#04837c`, Server error orange `#ab5803`, Network cyan `#0a7da1`, Assertion blue `#466cc8`, Timeout brown `#745f43`, Uncategorized `#6b6b6b`. New values, same shape: `schemaVersion` stays `1`. `CategoryDefinition.color` is now documented as a reference color that renderers may adapt per theme.
- **Categories without a configured color** take, in config rule order, the first palette color no other category of the report uses (gold, never used by a built-in category, comes last). Colors used to be assigned over every rule, so with the built-in categories present a configured category could share a color with one shown next to it. The same config with the same categories present always gives the same colors; set `color` for a color that never changes.
- **New built-in error category: Ambiguous locator**, evaluated first, before "Locator not found". It matches Playwright's `strict mode violation` (a locator resolving to several elements), which was "Uncategorized" or "Assertion" before. See [Error categories](docs/schema/v1.md#error-categories).

### Fixed

- **Run scope with `--no-deps`.** Playwright keeps `project.dependencies` in the config reporters get, so with `--project x --no-deps` the dependencies of `x` counted as running and the run could be reported `full` while a configured project was left out. They no longer count: the run is `partial` with the `project-filter` reason.
- **Run scope with `default: false` projects** (Playwright 1.64+). The reference for a full run is now the set of default projects: a plain run is `full` even though the non-default projects did not run, and `--project nightly` alone is `partial` because the default projects are missing. See [Default projects](docs/schema/v1.md#default-projects).
- **Run scope with several `--project` values.** `--project a b` selects two projects, as in Playwright; `b` was taken for a file filter and the run reported a `file-filter` reason.

## [0.0.2] - 2026-10-15

### Changed

- **Error signatures change: failures are grouped differently from 0.0.1.** Normalization now also replaces e-mail addresses with `<email>` and cuid-like and nanoid-like identifiers (20+ characters mixing letters and digits) with `<id>`, so the same failure for different users or records gets one signature. A signature computed by 0.0.1 for a message containing such values no longer matches. The JSON shape is unchanged: `schemaVersion` stays `1`. See [Error signature](docs/schema/v1.md#error-signature).
- **New built-in error categories**, evaluated after "Locator not found" and before "Network", "Assertion" and "Timeout": **Rate limited** (`Too Many Requests`, `rate limit`, a 429 in an HTTP context such as `status 429`, `HTTP 429` or `Response status: 429`) and **Server error** (a 500–599 status in the same contexts, or with its reason phrase such as `502 Bad Gateway`). Errors from `failOnStatusCode` and failed `expect(response).toBeOK()` that were "Uncategorized" or "Assertion" now land in these categories. A bare number (`429ms`, `Received: 500`) does not match. See [Error categories](docs/schema/v1.md#error-categories).
- The package description now lists only what exists today.

## [0.0.1] - 2026-10-13

First public release. Work in progress: the reporter and its JSON model are usable, the HTML renderer is a minimal skeleton.

### Added

- **Playwright reporter** (`@qartisan/playwright-loupe`) that writes `report.json`, a self-contained `index.html` with the report injected, and the attachments under `data/`. Works with `playwright test` and `playwright merge-reports`, including sharded runs merged from blob reports.
- **JSON report model, schema v1** (`schemaVersion: 1`), documented in [`docs/schema/v1.md`](docs/schema/v1.md) with a JSON Schema and exported TypeScript types (`import type { LoupeReport } from '@qartisan/playwright-loupe'`):
  - stable test ids (project + file + title path), identical across sharded, merged and unsharded runs;
  - run metadata: status, duration, Playwright version, git commit and branch, CI detection (GitHub Actions, GitLab, Azure Pipelines, CircleCI, Jenkins, Bitbucket, Buildkite, Travis), environment name, shard, workers;
  - run scope (`full` | `partial`) with the reasons it was detected (file filter, grep, project filter, last-failed, `--only-changed`, `test.only`, `LOUPE_RUN_SCOPE`, and others);
  - every attempt of every test (retries included), each with its errors, steps, annotations, stdout/stderr and attachments; screenshot comparisons are linked as expected / actual / diff;
  - normalized error signatures that group the same failure across tests and runs (ANSI codes, call log, UUIDs, URLs, dates, paths, durations, hex strings and numbers removed or replaced);
  - fields reserved for phase 2: `run.excluded` (always `null` in v1) and `notes` (always empty in v1).
- **Run errors** (`run.errors`): errors reported outside any test (a spec file that fails to load, a failing global setup or teardown, a worker fixture failing in teardown), with location, signature and category. A run with zero tests still produces a valid report. Run errors survive `merge-reports`; the `(<tags>) ` prefix `merge-reports` adds for a shard config with a `tag` is ignored by signatures and category rules.
- **Configuration**: `loupe.config.ts` (or `.mts`, `.js`, `.mjs`) next to `playwright.config.ts`, typed with `defineConfig()`, loaded through Playwright's own TypeScript transform. Options can also be passed inline in the reporter entry and through `LOUPE_*` environment variables (precedence: defaults < config file < inline options < environment variables). The config is validated at startup: an invalid option or an unknown key stops the run with an explicit message. See [`docs/config.md`](docs/config.md).
- **Error categories**: ordered regex rules matched on the message, stack or failing step titles; built-in rules (locator not found, network, assertion, timeout); `extend` or `replace` mode; a visible uncategorized bucket.
- **Dimensions**: automatic dimensions from prefixed tags (`@layer:api`), and configured dimensions from tags or annotations (`{ type: 'bug', description: 'BUG-1' }`), with optional expected values.
- **Minimal HTML renderer**: a self-contained page with the run summary (status, counts, duration, scope, environment, commit) and the tests grouped by project and suite. Renderer settings: `title`, `theme`, `screenshots.defaultView`. The full dashboard and test details come in later releases.

### Compatibility

- Node.js **22.12 or later** (`engines.node`), needed to load ES module config files. CI tests the latest Node.js 22.x and 24.x.
- `@playwright/test` **1.52 or later** (peer dependency). CI tests 1.52 (on Node.js 22) and the latest version. Playwright 1.52 hangs on recent Node.js 24 releases, independently of Loupe: see [Compatibility](README.md#compatibility).

[Unreleased]: https://github.com/qartisan/playwright-loupe/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/qartisan/playwright-loupe/releases/tag/v0.0.1
