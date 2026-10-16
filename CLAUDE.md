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
- The Playwright trace viewer needs an HTTP server, so trace viewing goes through a `show` command, not `file://`.

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
- `package.json` `files` ships only the build output plus README, LICENSE, CHANGELOG and `licenses/` (third-party licenses, e.g. the embedded DM Sans font).
- Code, comments, README, docs and commit messages in English.
- Config is validated at startup with explicit error messages; an invalid config must never fail silently.

## Testing

- Unit tests with Vitest.
- The fixture suite in `fixtures/` **intentionally** contains failing, flaky, skipped and slow tests, plus screenshots, videos and traces. Never "fix" these tests.
- The JSON produced from the fixture suite is snapshot-tested; any snapshot change must be intentional and reflected in the schema version when the shape changes.
- Renderer work uses the Vite dev server fed with a sample JSON; no need to rerun Playwright for UI changes.

## Commands

To be defined when the repo is scaffolded (build, test, fixture run, renderer dev server, show).

## Working agreement

- Implement from briefs; when a request conflicts with a non-negotiable principle, say so before writing code.
- Prefer small, reviewable changes.
- Do not add dependencies without stating why.