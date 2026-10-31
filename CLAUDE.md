# CLAUDE.md — playwright-loupe

## What this is

**Loupe** is an HTML reporter for Playwright, published as `@qartisan/playwright-loupe` (MIT). It gives a clear dashboard, a real separation of projects, suites and tags, rich failure details and, later, history and flakiness tracking.

Loupe is "a reporter for Playwright" — not affiliated with Microsoft. Never present it as an official Playwright tool.

Product vision and decisions: [`docs/vision.md`](docs/vision.md). Read it before making product or data model choices, and update it when a decision changes.

## Non-negotiable principles

1. **Zero machinery.** No external runtime, no mandatory separate CLI, minimal runtime dependencies.
2. **Native Playwright primitives only.** Tags, annotations, `test.step`, attachments, `testInfo`. Users must never need to change their tests or import a Loupe API in test code. All enrichment comes from configuration.
3. **Generic core.** Nothing specific to QArtisan or any consumer suite in `src/core`. Consumer-specific behavior goes through config and presets.
4. **No AI calls.** The "AI prompt" feature only copies text to the clipboard. No network calls to AI providers, no auto-healing.
5. **The JSON model is the public contract.** It is versioned (`schemaVersion`). Never change its shape without bumping the version and updating the schema docs.

## Architecture

```
src/
  core/       # Playwright Reporter implementation → produces the JSON model
  renderer/   # Standalone HTML report built from the JSON model (Vite)
  config/     # defineConfig(), defaults, validation
  shared/     # Pure modules used by core and renderer (category palette, color math)
fixtures/     # Fixture Playwright suite that generates realistic results
test/         # Vitest unit tests and JSON snapshots
```

- `core` and `renderer` are separate entry points of a single package. No monorepo tooling for now.
- The renderer is built into a self-contained HTML file; the reporter injects the JSON into it.
- The report must stay compatible with `merge-reports`.
- The Playwright trace viewer needs an HTTP server and cannot run over `file://`. Today the trace card copies `npx playwright show-trace <absolute path>`, to run from the project root. An optional `show` command serving the report on 127.0.0.1 was investigated in brief 08b and is not built; if it is ever built, it must stay optional (no mandatory separate CLI).

## Data model requirements (v1)

- Stable test identity (file + title path + project)
- Run metadata: commit, branch, environment, CI, duration, Playwright version, run scope (`full` | `partial`)
- Normalized error signature (IDs, timings and URLs stripped)
- All attempts (retries) with their attachments, not only the final result
- Computed dimensions and error category per test

## Product behavior (phase 1 scope)

- Dashboard built as a list of widgets: verdict, "look at first" list, error categories, project cards, dimension widgets, slowest tests, skipped tests.
- Collapsible sidebar (projects → suites → tests) with full-text search and filters; filter state synced to the URL.
- Test detail: error, steps, screenshots (side-by-side, slider, overlay, diff), video, trace, copyable rerun command, copyable AI prompt — organized per attempt.
- Error categorization: ordered regex rules, built-in defaults, `extend` / `replace` mode, visible "Uncategorized" bucket.
- Dimensions from prefixed tags (`@layer:api`) and annotations (`{ type: 'bug' }`).

Out of scope for phase 1 (prepare in the data model, do not implement): history, flakiness score, run diff, role presets, hosted service.

## Conventions

- TypeScript strict, ESM.
- `@playwright/test` is a `peerDependency`.
- Two Playwright floors, both in `src/core/support.ts`: the **supported floor** (`MIN_PLAYWRIGHT_SUPPORTED`, 1.57; policy: minor versions released in the 12 months before a Loupe release, raised only in a minor release; a stderr warning below it) and the **technical floor** (`MIN_PLAYWRIGHT_INSTALLABLE`, 1.52, the peer dependency lower bound, raised only when it must be). Each has a CI job; `test/support.test.ts` keeps `package.json`, `ci.yml`, the README and `docs/support.md` in line. See [`docs/support.md`](docs/support.md).
- Reads of Playwright internals (`_only`, `configInternalSymbol`, `_mode`, `configDir`, `metadata.actualWorkers`) must never throw: degrade instead (`test/internals.integration.test.ts`).
- `package.json` `files` ships only the build output plus README, LICENSE, CHANGELOG and `licenses/` (third-party licenses, e.g. the embedded DM Sans font).
- Code, comments, README, docs and commit messages in English.
- Config is validated at startup with explicit error messages; an invalid config must never fail silently.

## Testing

- Unit tests with Vitest.
- The fixture suite in `fixtures/` **intentionally** contains failing, flaky, skipped and slow tests, plus screenshots, videos and traces. Never "fix" these tests.
- The JSON produced from the fixture suite is snapshot-tested; any snapshot change must be intentional and reflected in the schema version when the shape changes.
- Renderer work uses the Vite dev server fed with a sample JSON; no need to rerun Playwright for UI changes.

## Commands

The npm scripts of `package.json`; the README's Development section describes each one.

- `npm run build`: reporter (`dist/`) and self-contained renderer template (`dist/renderer/index.html`).
- `npm run typecheck`: core, tests, fixtures and renderer.
- `npm test`: builds, then runs every Vitest test (unit, browser, integration).
- `npm run fixtures`: builds, then runs the fixture suite into `loupe-report/` (intentional failures).
- `npm run sample:update`: rewrites the renderer sample `src/renderer/dev/sample.json` from the fixture suite.
- `npm run perf:sample`: writes 5,000-test reports to `loupe-perf/`; `-- --measure` times the Tests view.
- `npm run dev:renderer`: Vite dev server for the renderer, on the sample.
- `npm run demo`: builds, then runs the demo suite (`demo/`) into `demo-report/` and checks it fails exactly as intended; `-- --open` opens it.
- `npm run demo:screenshots`: regenerates the README images in `docs/images/` from a CI-built `demo-report/` (it refuses a locally built one).
- Accessibility suite alone: `npm run build && npx vitest run test/renderer-a11y-browser.test.ts`. To add a state, one line in its `MATRIX`; accepted findings in `test/a11y-allowlist.ts`, each with its reason (an unused entry fails a full run). See the README's "Accessibility tests".

There is no `show` command: traces open with `npx playwright show-trace <file>`, which the report's trace card copies.

## Releasing

Claude Code prepares and verifies a release; the maintainer runs `npm version`, `npm publish`, the tag and every push. The full procedure, its checks and the recovery steps are in [`docs/releasing.md`](docs/releasing.md).

- **Choosing the version.** Patch for fixes and improvements, minor for a new version line, as practiced since 0.1.0. `1.0.0` is not on the table until the history design (phase 2) is settled.
- **`schemaVersion` is independent** from the package version (`src/schema/v1.ts`, policy in `docs/schema/v1.md`). It changes only with the JSON shape, noted in the CHANGELOG. A change in how signatures are computed keeps `schemaVersion` but always gets a CHANGELOG note.
- **CI**: six jobs in `ci.yml` (lockfile Playwright on Node 22 and 24, 1.52 and 1.57 on Node 22, latest on Node 24, demo), all green before a release, even when a job is red for an environment reason; `weekly.yml` runs the latest Playwright every week. Both call `checks.yml`.
- **Minor release**: check the supported floor against the policy with the npm `time` field before preparing it (`docs/releasing.md`, step 4).
- **Patch from an older tag** (as 0.1.9): a `release/<version>` branch cut at the tag in a worktree, released from it, then merged into `main`.
- **What Claude Code prepares**, left in the working tree:
  - the CHANGELOG: `## [Unreleased]` becomes `## [<version>] - <YYYY-MM-DD>` under a new empty `## [Unreleased]`; at the bottom, `[Unreleased]` compares `v<version>...HEAD` and a new `[<version>]` line compares `v<previous>...v<version>`. It proposes the commit `docs: prepare <version>`, which the maintainer commits and pushes before `npm version`;
  - when the UI visibly changed, the README screenshots (`npm run demo:screenshots`), from the CI `demo-report` artifact the maintainer downloads into `demo-report/`, for a `docs: refresh the README screenshots` commit;
  - the read-only pre-flight checks of `docs/releasing.md`, once CI is green on that commit, and the tag check after the bump.
- **During a release, Claude Code never runs** `npm version`, `npm publish`, `npm deprecate`, `git commit`, `git tag` or `git push`, and never changes `package.json` or `package-lock.json`.
- **A release never includes** a `*.tgz` in git, a report, or a version change made by Claude Code.

To try a local build in a consumer project, give it a prerelease version first, `npm version prerelease --preid=dev --no-git-tag-version` (for example `0.1.5-dev.0`), then `npm pack` and install the tarball. This dev version is never committed and must be reverted in `package.json` and `package-lock.json` before a release. Never pack a tarball with an already published version number: npm treats it as installed and will not reinstall it.

## Working agreement

- Implement from briefs; when a request conflicts with a non-negotiable principle, say so before writing code.
- Prefer small, reviewable changes.
- Do not add dependencies without stating why.

## Scratch work and deliberate breakage

- Scripts that break code on purpose (mutation checks), reinstall
  dependencies or rebuild run only in a scratch copy, never in the
  repository itself.
- Every such script starts with `set -euo pipefail` and a guard that
  aborts if the current directory is the repository (compare
  `git rev-parse --show-toplevel` with the repository path).
- The session scratchpad can be wiped between sessions: anything Gilles
  must use later (a Windows kit, a report) goes to a stable path
  outside /tmp and its path is given in the report.