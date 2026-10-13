# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0, minor versions may contain breaking changes. The JSON report has its own version (`schemaVersion`), see [`docs/schema/v1.md`](docs/schema/v1.md#versioning-policy).

## [Unreleased]

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
