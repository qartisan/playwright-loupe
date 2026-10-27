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
- A **renderer** builds a self-contained static HTML report from that model. It is a Preact application with `@preact/signals`, built by Vite into one HTML file with its JS and CSS inlined. Both libraries are bundled into that file, so the published package keeps zero runtime dependencies.
- The report works from `file://`, so navigation uses hash routes (`#/test/<id>`). The URL is the single source of navigation state, and later of filter state.
- Other outputs (PR Markdown summary, notifications) will plug into the same model later.
- The report stays compatible with `merge-reports`.
- The Playwright trace viewer requires an HTTP server, so a trace cannot open from `file://`. The report gives the `npx playwright show-trace <path>` command to copy, run from the project root with the project's own Playwright: over `file://`, the renderer computes the trace's absolute path from its own location, so every command of the report follows the same working-directory rule (over HTTP the path stays relative to the report folder). Planned follow-up: an optional `show` command serving the report from a local server (`127.0.0.1`, through Playwright's public CLI only) so that a trace opens in one click. It is never mandatory: the report stays fully usable without it.

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

Paths in the model are relative to Playwright's root dir (`config.rootDir`) rather than to the config file, because that is the base `merge-reports` uses: a merged sharded run then has the same paths and test ids as a normal run. The report holds no absolute path of the machine that wrote it: paths in stacks, messages and every other string are rewritten relative to the root dir, or masked as `~` under a home directory, after ids, signatures and categories are computed from the original text ([Paths in text](schema/v1.md#paths-in-text)). Failure-point keys and locations therefore do not depend on where the report was written, which phase 2 needs to compare runs across environments.

**Run-level errors are part of the model.** A spec file that fails to import makes Playwright run no test at all; a failing global setup does the same. Such a run has errors but no failed test, and a project can silently disappear from the report. Loupe records these errors in `run.errors`, keeps them through `merge-reports`, and the dashboard must show them prominently, above everything else.

Presentation choices (title, theme, default screenshot view) are **renderer settings**, injected next to the data in the HTML. They are not part of the data contract.

## User interface

### Layout

A collapsible sidebar holds the navigation: search, filters and a tree of projects → folders → files → describe blocks → tests (the folder prefix shared by every file is left out), with a status icon per test and counters per node. A level with a single child describe block is merged with it (`login.spec.ts › login`); projects always stay visible. The main area shows the dashboard or the selected item at full width. On narrow screens the sidebar is a drawer over the content: the content is inert under a backdrop while it is open, and Escape, a click on the backdrop, "Skip to content" or a page change closes it; Escape returns focus to the toggle when focus was inside, and never collapses the docked sidebar of wide screens.

The header carries the run summary in three groups that wrap as units (identity and verdict; status counts; start, duration and environment), with the controls (shortcuts, theme switch) always top-right. A partial run shows a pill next to the status, with its first reason ("Partial: grep filter", "+2" when there are more; "Partial" alone on narrow screens), styled as information rather than a warning: it links to the Run details, which hold every reason, and moves focus there. The rest of the run metadata is in the Overview's Run details card, in three groups: Run (scope, CI, workers, shard), Code (commit, branch, repository) and Environment (Playwright, Loupe, Node, OS), as plain text: no links, which would need provider-specific URL rules.

### Entry dashboard

The dashboard answers three questions in five seconds: *Is it green? What broke? Where is the problem?*

The dashboard is a list of widgets, split into three views **by subject**, each a fixed sidebar entry with its own route:

- **Overview** (`#/`): the verdict on top (outcome, a stacked bar of the outcomes with their counts, pass rate, duration), then run errors when there are any, as a prominent warning right under the verdict, then the common failure points when there are any (functions of the user's code shared by the stacks of failures across files and error groups: a lead, not a diagnosis), then compact error categories (each opening its category in the Errors view), then project cards, then the run details (`#/run-details` opens the Overview on them, their heading focused: the partial run pill links there). A report with run errors is never presented as green.
- **Errors** (`#/errors`): run errors first, every error group (most failed tests first, then most flaky), then the categories in detail. Groups only seen after a test timeout (every occurrence is a further error of an attempt whose first error is the test timeout) are folded at the end of each list and left out of the group counts, with a mention. Error groups live here only. The sidebar entry carries a warning marker and the count when the run has run errors.
- **Suite health** (`#/health`): one widget per dimension with tag hygiene (unknown values, values differing only by case), slowest, skipped (with why: the reason of their `skip` / `fixme` annotation, or "Not run" when Playwright skipped them without one) and flaky tests. A dimension adapts to its number of values: one stacked bar per value up to about 8 values, a grid of tiles colored by worst status above (problem values first, details on hover and focus); the exact table is always one click away.

**Pass rate**, one definition everywhere: passed / (total − skipped). Skipped tests are excluded and flaky tests do not count as passed. It is always labeled "pass rate" and explained in a tooltip.

Error groups have their own page (`#/group/<signature>`). Without history, history-based widgets are absent rather than empty.

*Refinement of the "single dashboard built from widgets" decision:* the widgets are grouped into views by **subject** (what you are looking at), not by **role** (who is looking). Role presets (phase 3) still select, order and size widgets within these views; there is no separate dashboard per role.

### Theme

The renderer has a light and a dark theme with a visible switch. The default follows the system preference; `theme` in the config sets another default; the viewer's choice is remembered in the browser.

Visual identity: QArtisan's palette adapted for a test report, as CSS custom properties defined once per theme, and DM Sans embedded in the HTML (the report works offline from `file://`), with a system monospace stack for errors and stack traces. Sage green is reserved for the passed status and the "Loupe" wordmark; links, selection and focus use the text color and a muted background, never a hue. A status color is always paired with an icon. Contrast is checked automatically: 4.5:1 for text, 3:1 for borders and icons, in both themes. The built report has a size budget: a warning above 100 kB gzip, a failed build above 150 kB.

### Search and filters

Full-text search and combinable filters. The search (`q`) matches every word, as a substring, ignoring case and accents, in the title path, the file path, the project name, every raw tag (including those a dimension takes, so `layer:api` matches), the dimension values (annotation-based ones included) and the skip reason of a skipped test (its text only, not the `Skipped` / `Not run` label). Filter state is synced to the URL so a view can be shared: one state for the whole report, in the hash query (`#/tests?status=failed,flaky&dim.Layer=api`), OR within a filter, AND across filters. The Tests view offers one filter per facet, in this order: status, error category (URL parameter `category`), project, tag, then the dimensions in config order. It reduces the sidebar and the Tests view, which is in declaration order by default (project, file, line), like the sidebar; the overview, errors and suite health views stay summaries of the whole run. Clicked filters add a history entry (Back undoes them); typing in the search does not. The error category filter uses every category of a test's failing attempts, the same definition as the dashboard counts. Each tag is filterable in exactly one place: a tag whose prefix is the key of a tag dimension in the report (configured, or automatic from its prefix) is filtered through that dimension only (`@layer:ui` → the Layer filter, value `ui`, including values outside the declared ones); unprefixed tags (`@smoke`) and prefixed tags no dimension takes stay in the tag filter, which is hidden when no tag is left. A `tag=` value a dimension takes is dropped from the URL. Annotation dimensions do not take tags. Each row of the Tests view shows the test's dimension values (config order) and free tags (sorted) as neutral chips under its title, following the same one-place rule; a chip toggles its value in the filters (a history entry, like any clicked filter). At most four per row, then "+N" expands the row in place (not in the URL); active chips are never hidden behind "+N", the other slots are filled in the normal order. Other annotations stay in the test detail. The JSON keeps every raw tag.

### Test detail

Error, steps, attachments and a copyable rerun command, organized **per attempt** so a failed retry can be compared with a passing one. The default attempt is the last failing one (a flaky test opens on its failure, not on the passing retry); the attempt is in the URL (`?attempt=1`).

- **Errors**: the model stores messages without ANSI codes, so the renderer rebuilds Playwright's colors from the text it actually prints: `Expected:` / `Received:` label lines (and their variants, `Expected substring:`, `Received string:` …), `- Expected` / `+ Received` diff blocks, and the snippet's arrow and caret lines. Anything else stays plain; Playwright's character-level highlighting inside strings is not reproduced.
- **Steps**: `test.step` steps and failing steps by default (with the ancestors that place them), every category on demand (`?steps=all`). The failing path starts expanded.
- **Rerun commands**: POSIX shell commands (not `cmd.exe`) to run from the Playwright root directory: one test (by identity: its project only), the failed tests of its file (when another line failed), the failed tests of the current list. Arguments sorted by file then line; projects with the same arguments share one command (repeated `--project`), different sets are split and joined with `&&`. Flaky tests are not "failed". A `file:line` is the declaration line, so a command is only valid while the file is unchanged.
- **Navigation**: previous / next follow the Tests view's current list (filters and sort, no render cap). The default sort is declaration order (project, file, line), the same in the sidebar, the table and previous / next: filters, not the default order, focus on failures. On an error group page, previous / next follow the Errors view's order, restricted to a category when the page was opened from one. Single-key shortcuts, all typed without modifiers on common layouts (US QWERTY, BE/FR AZERTY): `j`/`k` for next / previous (tests on a test detail, groups on an error group page), `o`/`e`/`h`/`t` for the four views, `/` and `?`; a switch in the shortcuts dialog turns them off (WCAG 2.1.4). No shortcut for attempts: `[`/`]` needed AltGr on AZERTY, which Windows reports as Ctrl+Alt; the attempt tabs stay keyboard operable.
- **Screenshots**: thumbnails and a lightbox (native `<dialog>`, previous / next, actual size); for `toHaveScreenshot`, one comparison per image name with four modes (diff, side-by-side, slider, overlay), only those the images allow. The default is Diff when there is a diff image, else side by side; the chosen mode is shared by all comparisons for the session, in memory only (not configurable, not in the URL). Images of different sizes are aligned top-left and their sizes shown. Files stay in `data/`, never inlined.
- **Videos**: played inline.
- **Traces**: a copyable `npx playwright show-trace` command (POSIX quoting) with the run's Playwright version as the minimum (an older trace viewer shows an empty screen on a newer trace), and a download link. Planned: one-click opening through the optional `show` command.
- **AI prompt**: a button copies a ready-to-paste prompt, in English, to the clipboard. Phase 1 includes the test, its tags and annotations, the error (message, snippet, location, stack unless `aiPrompt.includeStack` is `false`), the failing step with the steps before it, error category and attachment names. Test source, ARIA snapshot, signature and historical context come later. Loupe never calls an AI service itself.

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
- Each category has a color reused across charts and badges, from a palette of eight hues without reds or greens (a category must never read as a status), distinct enough to tell apart (ΔE2000 ≥ 15). A config color is a palette name or any `#rrggbb` color; the report stores a reference color, and the renderer derives per-theme shades that pass the contrast rules.
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

- **Recorded in CI only by default.** `history.record: 'ci-only'` is the default: only runs in CI are added to the history, so local and IDE runs never pollute statistics, whatever their scope. Scope detection (below) remains complementary information: a partial CI run is recorded, and what it counts in depends on its scope.
- **Partial runs.** Loupe detects the run scope and marks it `full` or `partial`, with its reasons (`run.scopeReasons`: `env`, `file-filter`, `grep`, `project-filter`, `last-failed`, `only-changed`, `test-list`, `only`, `shard`, `list`). "Partial" is not binary: a run filtered on one project is complete for that project, while `--last-failed` covers a biased slice. Statistics follow the scope:
  - **Scope signature.** History compares runs of the same scope signature: the projects covered, plus the kind and value of the filter. A run filtered on `--project api` is compared with other `--project api` runs, not with full runs.
  - **Excluded from run-level statistics by default:** `last-failed`, `only-changed`, `test-list`, `only`, `list`, `file-filter`, an unmerged `shard`, and `env` unless the signature matches.
  - **Comparable within the same signature:** `project-filter`, and `grep` with the same pattern values.
  - **Per-test statistics** use every run in which the test executed, except `list` (nothing ran) and `last-failed`, which only reruns tests that already failed and would bias a test's pass rate.
  - **Known limit:** shards that were filtered and then merged produce a report marked `full`, since `merge-reports` does not see the shards' filters. This is the largest bias. It is not excluded automatically: such runs are flagged.
  - Manual exclusion with a reason stays, for anything the rules above miss.
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

- **Next schema bump.** Two additive fields are candidates, to ship together in one new `schemaVersion` (a new key under `run` or `run.git`, both `additionalProperties: false`, is a shape change):
  - **Dirty working tree.** Comparing a local run with a preview run needs to know whether the local run had uncommitted changes: `git.dirty: boolean | null`, from `git status --porcelain --untracked-files=no` with `GIT_OPTIONAL_LOCKS=0`, so untracked report and test output folders do not count.
  - **Structured scope.** The scope signature of phase 2 needs more than the readable reasons: `run.selection` with `projects` (those that ran, sorted), `referenceProjects` (the config's default projects; `null` when unknown, such as under `merge-reports`), `grep`, `grepInvert` and `files` (POSIX paths relative to `rootDir`). Filter values are recorded, and go through the secret redaction like every other string.

- How the VS Code extension runs tests, and whether it keeps the reporters declared in the config.
- **One cause, many failures.** When one cause (a rate-limited or failing backend, a broken fixture) makes many tests fail, the report should lead to it rather than only list its consequences. Since 0.1.3, the Overview's common failure points give a first lead from the stacks: functions of the user's code shared by failures across spec files and error groups, derived in the renderer from existing fields (no model change), with thresholds that will be tuned. Still open: whether the computation moves to the core once history needs a stable key, and other signals such as the chronologically first error. Attempts already carry `startedAt` and `durationMs`, but errors have no time of their own and run errors none at all: decide in the data model how errors are ordered before implementing that.