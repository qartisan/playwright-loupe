# Loupe — Product vision

> Loupe is a reporter for Playwright. It is not affiliated with Microsoft or the Playwright project.

This document records the product decisions behind Loupe. It is the reference for contributors and for anyone wondering *why* Loupe works the way it does. Decisions can change, but changes should be made here first.

## Why Loupe

Playwright's built-in HTML report is solid but limited for larger suites:

- projects are not clearly separated;
- the overview is minimal;
- there is no history, no flakiness tracking and no grouping of similar failures.

Existing alternatives each come with a trade-off. Allure has great views but needs a Java runtime and a dedicated API in test code. Monocart is feature-rich but uses a half-navigation, half-detail layout.

Loupe aims to be **a reporter built by QA engineers for QA engineers**: readable by a developer and by a manager, with no heavy tooling.

## Principles

These are non-negotiable. Any proposal that conflicts with them must be flagged before implementation.

1. **Zero machinery.** One npm dependency, no external runtime, no mandatory separate CLI.
2. **Native Playwright primitives only.** Tags, annotations, `test.step`, attachments and `testInfo`. An existing project gets the full report without changing a single test. All enrichment comes from configuration.
3. **Sidebar navigation, full-width detail.** Navigation context stays visible; the detail view is never cramped.
4. **First-class attachments.** Screenshots, videos and traces are available directly in the test detail, per attempt.
5. **No AI calls.** The AI prompt feature only copies text to the clipboard. No network calls to AI providers, no auto-healing.
6. **Generic core.** Nothing specific to a given consumer in the core. Specific needs go through configuration and presets.

## Architecture

- A **core** reporter produces a **versioned JSON model**. This model is the public contract.
- A **renderer** builds a self-contained static HTML report from that model.
- Other outputs (PR Markdown summary, notifications) will plug into the same model later.
- The report stays compatible with `merge-reports`.
- The Playwright trace viewer requires an HTTP server, so traces are opened through a `show` command rather than `file://`.

## Data model

The JSON model is designed for the full roadmap, even if phase 1 renders only part of it.

| Decision | Why | Enables |
| --- | --- | --- |
| Stable test identity (file + title path + project) | Follow a test across runs | History, flakiness, run diff |
| Run metadata (commit, branch, environment, CI, duration, Playwright version, scope) | Situate each run | Environment comparison, trends |
| Normalized error signature (IDs, e-mails, timings, URLs stripped) | Group similar failures | Recurring failures |
| All attempts kept, with their attachments | Keep retry information | Flakiness diagnosis |
| `schemaVersion` | Evolve the contract safely | Compatibility of stored history |
| Dimensions and error category computed at run time | Rendering independent of config | Filters, matrices, statistics |
| Run-level errors (load errors, global setup / teardown failures) in the model | A run that broke before or around its tests must never look clean | A prominent warning, infra triage |

The schema is documented and public. Its shape never changes without a version bump. Schema v1 is specified in [`docs/schema/v1.md`](schema/v1.md), with a [JSON Schema](schema/report-v1.schema.json).

Paths in the model are relative to Playwright's root dir (`config.rootDir`) rather than to the config file, because that is the base `merge-reports` uses: a merged sharded run then has the same paths and test ids as a normal run.

**Run-level errors are part of the model.** A spec file that fails to import makes Playwright run no test at all; a failing global setup does the same. Such a run has errors but no failed test, and a project can silently disappear from the report. Loupe records these errors in `run.errors`, keeps them through `merge-reports`, and the dashboard must show them prominently, above everything else.

Presentation choices (title, theme, default screenshot view) are **renderer settings**, injected next to the data in the HTML. They are not part of the data contract.

## User interface

### Layout

A collapsible sidebar holds the navigation: search, filters and a tree of projects → suites → tests, with counters per node. The main area shows the dashboard or the selected item at full width.

### Entry dashboard

The dashboard answers three questions in five seconds: *Is it green? What broke? Where is the problem?*

- **Run errors**: when `run.errors` is not empty, a prominent warning comes first, before the verdict. A report with run errors is never presented as green.
- **Verdict**: status, pass rate, test count, duration, environment, commit. Difference with the previous run once history exists.
- **Look at first**: failures grouped by error signature, isolated failures, flaky tests; new failures once history exists.
- **Project cards**, error category breakdown, one widget per dimension.
- **Secondary**: slowest tests, skipped tests.

The dashboard is a list of widgets. Without history, history-based widgets are absent rather than empty. Role presets (phase 3) select, order and size widgets; there is no separate dashboard per role.

### Theme

The renderer has a light and a dark theme with a visible switch. The default follows the system preference; `theme` in the config sets another default; the viewer's choice is remembered in the browser.

### Search and filters

Full-text search and combinable filters. Filter state is synced to the URL so a view can be shared.

### Test detail

Error, steps, attachments and a copyable rerun command, organized **per attempt** so a failed retry can be compared with a passing one.

- **Screenshots**: lightbox; for `toHaveScreenshot`, four comparison views (side-by-side, slider, overlay, diff). The default view is configurable and the user's choice is remembered in the browser.
- **Videos**: played inline.
- **Traces**: embedded Playwright trace viewer.
- **AI prompt**: a button copies a ready-to-paste prompt to the clipboard. It includes the error, step, test source, ARIA snapshot, error category and signature, and later historical context. Loupe never calls an AI service itself.

## Dimensions

A dimension is an analysis axis built from native Playwright data.

- **Prefixed tags** for closed sets of values: `@layer:api`, `@module:4`, `@priority:p1`. Unprefixed tags go to a "Free tags" group.
- **Annotations** for unique or open values: `{ type: 'bug', description: 'BUG-21' }`, owner, ticket.

```ts
dimensions: [
  { name: 'Layer', from: 'tag', prefix: 'layer', values: ['api', 'ui', 'e2e'] },
  { name: 'Bug', from: 'annotation', type: 'bug' },
]
```

Each dimension provides a sidebar filter, a dashboard widget and cross-analysis with projects. The optional `values` list lets Loupe report unknown values (typos) and tests missing a value.

## Error categorization

Each failure gets a category from ordered regex rules; the first match wins.

- Built-in default rules: locator not found, rate limited, server error, network, assertion, timeout. Setup and teardown failures are not built in: they depend on each suite's naming and belong in its config.
- `match` accepts one regex or a list; `on` targets the message, the stack, the step name, or all of them.
- Each category has a color reused across charts and badges.
- `extend` mode adds to the defaults, `replace` mode drops them.
- A visible **Uncategorized** bucket signals a missing rule.

## Configuration

A dedicated config file, `loupe.config.ts`, typed through `defineConfig()`. Inline options in `playwright.config.ts` are also supported.

**Precedence**: defaults < config file < inline options < environment variables.

The config is validated at startup with explicit error messages. An invalid config never fails silently: it stops the run. Unknown keys are errors, with a "did you mean" suggestion. Reference: [`docs/config.md`](config.md).

| Option | Purpose |
| --- | --- |
| `extends` | Base preset |
| `screenshots.defaultView` | `side-by-side`, `slider`, `overlay` or `diff` |
| `categories` | Error categorization rules |
| `dimensions` | Tags and annotations exposed as analysis axes |
| `title`, `logo`, `theme` | Visual identity, light and dark themes (`theme`: `system`, `light` or `dark`) |
| `environment` | Environment name of the run (`LOUPE_ENV` overrides it) |
| `locale` | English and French |
| `history` | Storage location, retention, analysis window, and when runs are recorded (`history.record`) |
| `attachments` | Embed or link, maximum video size |
| `dashboard` | Widget list or role preset |

## History and run types

Every run produces a report, but not every run counts in statistics.

- **Recorded in CI only by default.** `history.record: 'ci-only'` is the default: only runs in CI are added to the history, so local and IDE runs never pollute statistics, whatever their scope. Scope detection (below) remains complementary information: a partial CI run is recorded but excluded from statistics.
- **Partial runs.** Loupe detects the run scope (file filters, `--grep`, `--project`, `--last-failed`) and marks it `full` or `partial`. Partial runs, typically launched from the CLI or an IDE while debugging, are excluded from statistics by default so repeated reruns don't skew flakiness and trends.
- **Comments.** Notes can be attached to a run or to a test result and are stored with the history. Durable test-level notes (known bug, ticket) belong in annotations or configuration.
- **Excluded runs.** A run can be excluded with a mandatory reason, after the fact or at launch through an environment variable. It stays visible but no longer counts. Loupe may suggest an exclusion when most failures are infrastructure-related, but never applies one by itself.
- **Retention vs analysis window.** Retention defines what is kept (maximum runs and/or age, whichever limit is reached first). The analysis window defines what statistics are computed on (last N runs or last N days) and can be changed in the UI.

Since a static report cannot write, comments and exclusions go through a CLI command or through the local `show` server.

## Roadmap

1. **Phase 1 — A single run, well presented.** Dashboard, sidebar, search and URL filters, test detail with attachments, error categories, basic AI prompt.
2. **Phase 2 — Memory.** History, flakiness score, run diff, recurring failures, duration trends, environment comparison.
3. **Phase 3 — Roles and configuration.** Dashboard presets, trainer view, test ownership, dimension matrices.
4. **Phase 4 — Outputs and service.** PR Markdown summary, notifications, health badge, optional hosted service.

Each phase ships before the next one starts. Future features are prepared in the data model without being implemented early.

## Non-goals

- A Java runtime or any external process.
- A Loupe API to import in test code.
- Calls to AI providers or automatic test repair.
- A half-navigation, half-detail layout.

## Open questions

- Renderer stack (UI framework or not).
- How the VS Code extension runs tests, and whether it keeps the reporters declared in the config.
- **Root cause vs consequence.** When one cause (a rate-limited or failing backend, a broken fixture) makes many tests fail, the report should point at the cause rather than list its consequences. Candidate signals: the most frequent signature of the run, the chronologically first error. Attempts already carry `startedAt` and `durationMs`, but errors have no time of their own and run errors none at all: decide in the data model how errors are ordered before implementing it.