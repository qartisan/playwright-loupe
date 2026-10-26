# playwright-loupe
Loupe — an HTML reporter for Playwright: a dashboard that shows what failed and why, error groups by normalized signature, tests grouped by project, file and describe block, and dimensions from tags and annotations. Native Playwright APIs only.

> **Status: work in progress — the JSON schema will change before 1.0.**

**[Live demo](https://qartisan.github.io/playwright-loupe/)**: the report of a small demo suite that fails on purpose, rebuilt at each release.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/qartisan/playwright-loupe/main/docs/images/overview-dark.png">
  <img alt="The Overview of the demo report: a failed run of 48 tests, with the common failure point signIn shared by 5 tests in 3 files, the failing tests per error category, and the sidebar listing the web and api projects and their spec files." src="https://raw.githubusercontent.com/qartisan/playwright-loupe/main/docs/images/overview-light.png">
</picture>

Loupe is a reporter for Playwright, not affiliated with Microsoft.

## Installation

```sh
npm install --save-dev @qartisan/playwright-loupe
```

Requires Node.js 22.12 or later and `@playwright/test` 1.52 or later. See [Compatibility](#compatibility).

## Usage

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['list'],
    ['@qartisan/playwright-loupe', { outputFolder: 'loupe-report', title: 'My suite' }],
  ],
});
```

After a run, open `loupe-report/index.html`. The raw data is in `loupe-report/report.json`, with attachments in `loupe-report/data/`. Its format is documented in [`docs/schema/v1.md`](docs/schema/v1.md), with a [JSON Schema](docs/schema/report-v1.schema.json) and TypeScript types (`import type { LoupeReport } from '@qartisan/playwright-loupe'`).

A run that broke outside its tests (a spec file that fails to import, a failing global setup) is reported in `run.errors`, even when no test ran.

## The report

The report is a single self-contained HTML file. It works offline, straight from `file://`, in light and dark themes. The screenshots below come from the [live demo](https://qartisan.github.io/playwright-loupe/).

**An error group**, shared by several tests:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/qartisan/playwright-loupe/main/docs/images/errors-dark.png">
  <img alt="An error group page: 3 tests failing with the same Server error, expect(response).toBeOK() failed with a 500 Internal Server Error, its sample message with the call log, and the affected tests with their project and file." src="https://raw.githubusercontent.com/qartisan/playwright-loupe/main/docs/images/errors-light.png">
</picture>

**Suite health**, by dimension:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/qartisan/playwright-loupe/main/docs/images/health-dark.png">
  <img alt="Suite health: a bar of passed, failed, flaky and skipped tests for each value of the Area and Owner dimensions, and the failing tests of each bug annotation." src="https://raw.githubusercontent.com/qartisan/playwright-loupe/main/docs/images/health-light.png">
</picture>

**Tests**, filtered:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/qartisan/playwright-loupe/main/docs/images/tests-dark.png">
  <img alt="The Tests view filtered on failed and flaky tests: 19 of 48 tests, the active filters as chips, a button copying the rerun command of the 17 failed tests, and the sortable table with status, test, project, file, duration and error category." src="https://raw.githubusercontent.com/qartisan/playwright-loupe/main/docs/images/tests-light.png">
</picture>

**A screenshot comparison**, in a test's attachments:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/qartisan/playwright-loupe/main/docs/images/test-detail-dark.png">
  <img alt="Screenshot comparison of a failed toHaveScreenshot test, in Side by side mode: the expected product card with a green Add to cart button next to the actual one with a blue button." src="https://raw.githubusercontent.com/qartisan/playwright-loupe/main/docs/images/test-detail-light.png">
</picture>

- **Header:** the run's verdict and status counts, its start, duration and environment; the shortcuts and theme controls stay top-right at every width. A [partial run](docs/schema/v1.md#run-scope) shows a pill after the verdict, "Partial: grep filter" ("+2" with more reasons, "Partial" alone on narrow screens), which opens the run details (`#/run-details`) where every reason is listed.
- **Overview:** verdict with pass rate, run errors first when the run broke outside its tests, [common failure points](#common-failure-points), error categories, project cards, and the run details in three groups: Run (scope, CI, workers, shard), Code (commit, short with a copy button; branch; repository) and Environment (Playwright, Loupe, Node, OS). Empty values are left out.
- **Errors:** every error group, built from normalized error signatures, with the failed / flaky split and links to the affected tests. Groups [only seen after a test timeout](#groups-only-seen-after-a-test-timeout) are folded at the end. A group page has previous / next buttons: from a category, they stay within that category.
- **Test detail:** title path, outcome, project, `file:line`, tags, annotations and dimensions, then one tab per attempt (the last failing attempt first; `?attempt=` in the URL): errors with Expected / Received and diffs highlighted and the code snippet, steps (`test.step` and failing steps, the failing path expanded; "Show all steps" for hooks, fixtures and API calls), attachments, stdout and stderr. Previous / next walk the Tests view's current list.
- **Attachments**, per attempt, linked from `data/` next to the report (never inlined in the HTML), all working from `file://`:
  - **Screenshot comparisons**: a failed `toHaveScreenshot` / `toMatchSnapshot` gives one card per image name, before the other screenshots, with four modes: Diff, Side by side (expected | actual, at one scale), Slider (actual over expected, a divider to drag or move with the arrow keys) and Overlay (actual over expected, its opacity to set). Only the modes the images allow are offered; Diff is the default when there is a diff image. The chosen mode applies to every comparison until the report is closed. Each image's size is shown, with a warning when expected and actual differ: slider and overlay align them top-left. "Open in viewer" shows the same modes in the viewer below.
  - **Screenshots** as thumbnails. A click (or Enter / Space) opens them in a viewer, after the comparisons: fitted to the window, or at actual size by clicking the image; previous / next with the buttons or `←` / `→`; "Open original" in a new tab. Escape, the close button or a click outside closes it, back on the same thumbnail. A missing file shows its name and path.
  - **Videos** play inline. A missing or unplayable file shows its path instead of an empty player.
  - **Traces**: "Copy trace command" copies `npx playwright show-trace <path>`, to run from your project root in a POSIX shell, like the rerun commands. When the report is opened from disk (`file://`), the path is the absolute path of the trace, so the command works from any directory; when the report is served over HTTP, the disk path is unknown and the path is relative to the report folder (the one containing `index.html`): run it from there. The trace viewer needs an HTTP server, so it cannot open from `file://`; the command uses the project's own Playwright, which must be at least the version that ran the tests (an older trace viewer shows an empty screen on a newer trace). The card says which version, and has a "Download trace" link.
  - Other files are listed as links; small text bodies inline, collapsed.
- **Copy buttons:** rerun commands (this test, the failed tests of its file, the failed tests of the current list) and an AI prompt describing the failure, in English. Both are only copied to the clipboard; nothing is sent anywhere. Projects failing on the same lines share one command (`--project=a --project=b`); otherwise each project gets its own, joined with `&&`.
  - The commands target **POSIX shells** (bash, zsh; not `cmd.exe`) and run from the Playwright root directory: paths in the report are relative to it.
  - A `file:line` argument targets the line where the test is declared and reruns every test declared on that line. A command is only valid while the file has not changed since the run.
- **Suite health:** dimensions from tags and annotations (with hints for unknown or inconsistent values), slowest, skipped (with why, see [Skip reasons](#skip-reasons)) and flaky tests.
- **Tests:** every test in one sortable list (by default in declaration order, as in the sidebar: project, file, line; the Status header sorts failed, flaky, passed, skipped), filtered by status, error category, failure point, project, tag and dimension, with the count each filter would give. Header counts, error categories, failure points and dimension values open it pre-filtered. Large lists show their first 500 rows, with "Show 500 more" and "Show all". Under each title, chips show what the test covers: its dimension values first (dimensions in config order, the value alone, `api`, with the dimension in the tooltip), then its other tags (`@smoke`), sorted. A tag a dimension takes appears only as that dimension's value. A chip adds its value to the filters, keeping the others and the sort; an active chip (with a ×) removes it, and Back undoes either. Up to four chips per row, active chips always among them; "+N" shows the rest. A skipped test shows why on a muted line under its title, above the chips.
- **Sidebar:** search (`/` to focus; every word must match, ignoring case and accents, the title path, file, project, tags, dimension values or the reason a test was skipped: `smoke`, `api`, `layer:api`, `sandbox`), projects, folders, files, `describe` blocks and tests, with status icons, failure counts and keyboard navigation. Each project leaves out the folder shared by its own files, so a project with its own test directory does not repeat it.
- **Filters in the URL:** search, filters and sort live in the link, so a filtered view can be shared or bookmarked, even from `file://`. A project without a `name` (Playwright's default project) cannot be selected in the project filter: an empty name cannot be written in the URL. Give your projects a name to filter by them. Each tag is filterable in one place only: a tag a dimension is built from (`@layer:ui` with a `layer` dimension, configured or automatic) is in that dimension's filter (Layer: `ui`), not in the tag filter, so the two can never be combined into an empty result. Unprefixed tags (`@smoke`) and prefixed tags no dimension uses stay in the tag filter. The failure point filter (`point`, the value `<file>#<function>` encoded like any other, `#` as `%23`: `point=fixtures%2Fsession.ts%23signIn`) offers the points of the Overview card; a test matches when the function is in the stack of one of its failing attempts.

### Skip reasons

A skipped test says why, in Suite health, under its title in the Tests view and next to its outcome in the test detail. The reason is the one given in your test code, read from the `skip` / `fixme` annotation Playwright records for `test.skip(condition, 'reason')`, `test.fixme(condition, 'reason')`, `testInfo.skip(…)`, in a test, a `describe` or a hook:

- `Skipped: <reason>` / `Fixme: <reason>`;
- `Skipped (no reason given)` / `Fixme (no reason given)` when the call has no reason (`test.skip('title', body)`, `test.describe.fixme`…);
- `Not run` when Playwright skipped the test without any skip annotation: usually because a dependency project or an earlier test of its serial group failed, the failure limit (`--max-failures`) was reached, or the run was stopped. The report does not say which, so Loupe does not guess.

The search matches the reason's text (not the `Skipped` or `Not run` labels). Reasons go through the same secret redaction as every other string of the report.

### Common failure points

When one problem breaks many tests, their errors rarely share a message: the same function fails at different lines, with different errors, in different categories. The Overview card **Common failure points** lists the functions of your code that appear in the stack of several failures, in different spec files and error groups. **It is a lead, not a diagnosis:** a shared helper also shows up when unrelated failures go through it.

- **What is counted:** every error of every failing attempt, flaky tests included (the card gives the failed / flaky split), read from its stack trace. A point is a function in a file, whatever the line: `fixtures/session.ts#signIn`, with the lines seen. Paths are relative to the Playwright root dir, with `../` for helpers outside it (`../helpers/api.ts`). Spec files (any file holding a test of the report), anonymous functions, `node_modules`, Node internals and Playwright's own frames are left out.
- **Thresholds:** a point is shown when at least **5** distinct tests (a test run in several projects counts once), **3** spec files and **2** error groups go through it. At most **5** points, the most tests first. A point below a threshold is shown nowhere.
- **Folding:** a function only reached through another one, by some of its tests, is listed under it (`via checkResponse`) rather than on its own. When their tests only partly overlap, both are shown.
- Each point opens its tests in the Tests view (the Failure point filter). The root dir is found from the stacks (the frames of each test's own file); when no stack shows it, the card is hidden.

Nothing is configured and nothing changes in your tests: the points are derived when the report opens, from the stacks Playwright records. The thresholds may change while the heuristic is tuned.

### Groups only seen after a test timeout

When a test times out, Playwright stops it and the action still running fails too (`Request context disposed`, `Target page, context or browser has been closed`, `locator.click: Test timeout of 30000ms exceeded`): a second error of the same attempt. Such follow-on errors can make up many error groups of a slow run.

- An error is **secondary** when it is not the first error of its attempt and that first error is Playwright's test timeout: `Test timeout of <n>ms exceeded.`, also while setting up or tearing down a fixture, in a `beforeEach` / `afterEach` hook, a fixture's own timeout and a `beforeAll` / `afterAll` hook timeout.
- A group is **folded** when every one of its errors is secondary. A group seen at least once as a first error stays visible.
- In the Errors view, folded groups move to a collapsed "N groups only seen after a test timeout" at the end of the list and of each category. Group counts leave them out and say so (`22 error groups · 18 more only seen after a test timeout`), on the Overview too; test counts are unchanged. On an error group page, `j` / `k` walk the visible groups first, then the folded ones.
- A folded group's page stays reachable, and in the test detail each secondary error keeps its place, labelled "Raised after the test timeout". The category of a test does not change: the second error is sometimes the most telling one.

### Keyboard shortcuts

| Key | Action | Where |
| --- | --- | --- |
| `j` / `k` | Next / previous test, or error group | Test detail, error group page |
| `o` / `e` / `h` / `t` | Overview, Errors, Suite health, Tests | Everywhere |
| `/` | Focus the search | Everywhere |
| `?` | Show keyboard shortcuts | Everywhere |
| `←` / `→` | Previous / next screenshot | Screenshot viewer |
| `Escape` | Clear the search, close a dialog or the narrow sidebar | Everywhere |

Single keys do nothing while typing in a field or with Ctrl, Alt or Meta held, nor while a dialog or the screenshot viewer is open; letters work with Caps Lock on. The keyboard icon in the header opens the same list, with a **Single-key shortcuts** switch: turn them off if they get in the way of your keyboard or assistive technology (WCAG 2.1.4). The choice is remembered in this browser. Escape and the arrow keys keep working. A view shortcut moves focus to the page's heading, like `j` / `k`. Attempts of a test are tabs: Tab to them, then the arrow keys.

In the sidebar, the view links and the test tree are one tab stop each: the arrow keys and Home / End move inside them, Enter or Space opens the page, focus stays in the sidebar, and Tab moves on. In the tree, Right and Left also expand and collapse groups.

On narrow windows (760 px wide or less), the sidebar opens over the content, as a drawer. While it is open, the content behind is dimmed and out of reach of Tab and of assistive technologies; the header stays reachable. Escape closes it, once whatever is inside has handled the key: the first Escape clears the search text, closes a dialog or hides a tooltip, the next one closes the sidebar. When focus was inside the sidebar, it returns to the sidebar button; otherwise it stays where it was. A click on the dimmed content also closes it, "Skip to content" closes it before moving focus to the content, and opening a page closes it, focus on the page's heading. On wide windows, Escape leaves the sidebar alone.

### Coming next

History and flakiness tracking are planned for a later phase; the JSON model is already prepared for them.

## Configuration

Put a `loupe.config.ts` next to `playwright.config.ts`:

```ts
// loupe.config.ts
import { defineConfig } from '@qartisan/playwright-loupe';

export default defineConfig({
  title: 'My suite',
  categories: {
    rules: [{ name: 'Infra', match: [/ECONNRESET/, /ECONNREFUSED/], color: 'teal' }],
  },
  dimensions: {
    definitions: [
      { name: 'Layer', from: 'tag', prefix: 'layer', values: ['api', 'ui', 'e2e'] },
      { name: 'Bug', from: 'annotation', type: 'bug' },
    ],
  },
  // Leave stack traces out of the copyable AI prompt (default: true).
  aiPrompt: { includeStack: false },
});
```

`aiPrompt.includeStack` (default `true`) sets whether the AI prompt copied from the test detail includes each error's stack trace. Like `title` and `theme`, it is a presentation setting written to `index.html`, not to `report.json`.

Options can also be passed inline (`['@qartisan/playwright-loupe', { title: 'Nightly' }]`) and through `LOUPE_*` environment variables. Precedence: defaults < config file < inline options < environment variables. The config is validated at startup: an invalid option, or a typo in a key, stops the run with an explicit message.

Every option, the lookup rules and the environment variables are documented in [`docs/config.md`](docs/config.md).

### Git information

The report records the commit, the branch and the repository URL of the run, each from the first source that has it: Playwright's metadata ([`captureGitInfo`](https://playwright.dev/docs/api/class-testconfig#test-config-capture-git-info)), then the CI variables (GitHub Actions, GitLab, Azure Pipelines, CircleCI, Jenkins, Bitbucket, Buildkite), then the local repository, which Loupe reads with read-only git commands. `git.local: false` or `LOUPE_GIT_LOCAL=0` turns off Loupe's own reads only: what Playwright put in its metadata is still used, so to record no git information on a local run, also set `captureGitInfo: { commit: false }` in the Playwright config. Loupe never reads the commit message, the author's name or e-mail. See [Git information](docs/config.md#git-information).

### Security

Reports are meant to be shared, so Loupe removes secrets from `report.json` and `index.html` before writing them, replacing each with `[redacted]`:

- **typed values** of `fill`, `type`, `pressSequentially` and `keyboard.*` steps on secret-looking fields (a password field, `getByLabel('Password')`, or a source line that names the value, `fill(password)`), and wherever Playwright repeats them in that attempt's errors;
- **HTTP header values** printed in call logs (`cookie`, `set-cookie`, `authorization`, and any header with a secret-looking name);
- **URL parameters** with a secret-looking name, wherever URLs appear (navigation steps, call logs, error messages): `?token=[redacted]`, `&access_token=[redacted]`;
- the **values of the environment variables you list** in `redact.env` (names only, never values), everywhere in the report. It is also the fallback for what the names above miss: a secret in a URL parameter with a neutral name (`?sig=…`), or printed by your code.

```ts
redact: { env: ['E2E_PASSWORD', 'API_TOKEN'] },
```

**Git information** is limited to the commit hash, the branch name and the repository URL with its credentials removed, whatever the source; a URL that cannot be cleaned safely is dropped.

**Attachments are not altered**: traces, screenshots and videos contain typed values and visible secrets, so a report with traces must be treated as private. Snippets (source excerpts around errors) are left as they are: they come from your repository. See [Secret redaction](docs/config.md#secret-redaction).

## Accessibility

Loupe targets **WCAG 2.2 level AA** for the report as delivered: the HTML file opened from disk. This section says what is checked; it is not a claim of conformance.

Checked automatically on every test run:

- **axe-core** on every view and its main states (Overview, Errors, Suite health, Tests, test detail, error group page, comparison viewer, screenshot viewer, dialogs), in the light and dark themes and a few under forced colours, at desktop width, at 360 px and at 320 × 180 and 320 × 256 (400 % zoom). A serious or critical WCAG violation fails the build.
- **Contrast** of every colour token and of the category colours, those derived from your own colours included, in both themes: 4.5:1 for text, 3:1 for borders and icons.
- **Keyboard and focus**: controls reached and operated with the keyboard, a visible focus ring, focus returned after every dialog, skip links to the content and to the test list, the narrow sidebar closing with Escape and keeping focus out of the content behind it, a page title per view, single-key shortcuts that can be turned off. When the view changes from the content, a shortcut or Back / Forward, focus moves to the new heading; from the sidebar, focus stays there and the page name is announced. The focused row of the sidebar tree stays visible.
- **Layout**: no horizontal scroll down to 320 px; on short viewports (high zoom) the page scrolls and the content stays reachable; hit areas of chips and small buttons at least 24 × 24 px.
- **Forced colours and reduced motion**: pressed and selected states, bars and focus rings in forced colours; no transition or smooth scrolling when reduced motion is requested.

Known limits:

- The automated tests run in **Chromium only**; Firefox was checked by hand with Orca (below), Safari not at all.
- Forced colours are checked with **Chromium's emulation**, not on Windows high contrast itself.
- Checked manually with Orca 50.3 and Firefox 158 on Fedora (October 2026): page and view announcements, sidebar and tree, dialogs, copy confirmations. Not yet tested with NVDA, JAWS or VoiceOver.
- Every row of the sidebar tree exposes its level, but Orca announces the level only when it changes from the previous row, not between rows of the same level.
- **Videos have no captions**: Playwright records them without audio, so there is nothing to caption.
- Some small links, inside sentences or on their own (such as "View error group" or a test title in a list), are smaller than 24 × 24 px: they rely on the inline and spacing exceptions of WCAG 2.5.8.

Found a barrier? [Open an issue](https://github.com/qartisan/playwright-loupe/issues) with the view, what you tried, your browser and, if you use one, your assistive technology.

## Compatibility

| | Supported | Tested in CI |
| --- | --- | --- |
| Node.js | 22.12 or later | latest 22.x and 24.x |
| `@playwright/test` | 1.52 or later | 1.52 (on Node.js 22) and the latest version |

Node.js 22.12 is the minimum because ES module config files are loaded with `require(esm)`, see [`docs/config.md`](docs/config.md#how-config-files-are-loaded).

> **Playwright 1.52 hangs on recent Node.js 24 releases.** `playwright test` never exits, even for a single passing test with the built-in `list` reporter and without Loupe: this is not caused by Loupe. Reproduced with Node.js 24.17.0; Node.js 24.11.1 is not affected, nor is Playwright 1.53 or later on Node.js 24.17.0. With Playwright 1.52, use Node.js 22, or upgrade Playwright.

## Development

| Command | What it does |
| --- | --- |
| `npm run build` | Builds the reporter (`dist/`) and the self-contained renderer template (`dist/renderer/index.html`). |
| `npm run typecheck` | Type-checks the core, tests, fixtures and renderer. |
| `npm test` | Builds, then runs the Vitest unit tests and the integration tests (fixture suite, and a sharded run merged with `merge-reports`). |
| `npm run fixtures` | Builds, then runs the fixture suite into `loupe-report/`. Its failures are intentional, see [`fixtures/README.md`](fixtures/README.md). |
| `npm run sample:update` | Builds, then runs the fixture suite with `fixtures/sample.config.ts` and writes its report to `src/renderer/dev/sample.json`: failures, flaky and skipped tests, a partial run and a run error. Its attachment files go to `src/renderer/dev/data/` (gitignored). |
| `npm run perf:sample` | Builds, then writes two 5,000-test reports to `loupe-perf/` (gitignored), from the renderer sample: `sample` (its own tags) and `heavy` (7 to 8 chips per row). Add `-- --measure` to time opening, filtering, sorting and searching the Tests view in Chromium (median of 7 runs), and `--renderer <index.html>` to time another renderer build, for a before / after comparison. |
| `npm run demo` | Builds, then runs the demo suite ([`demo/`](demo/README.md)) into `demo-report/` (gitignored) and checks that it fails exactly as intended: the live demo report comes from it. Add `-- --open` to open the report. A report built locally holds your local paths: it is not for publishing. |
| `npm run demo:screenshots` | Regenerates the README screenshots in `docs/images/`, light and dark, from a **CI-built** demo report in `demo-report/` (the `demo-report` artifact of the CI's "Demo suite" job). It refuses a report built on your machine. |
| `npm run dev:renderer` | Vite dev server for the renderer, fed with `src/renderer/dev/sample.json`, with hot reload; it serves the sample's attachments at `data/`. No Playwright run needed for UI work. |

Tests that drive a browser need Chromium: `npx playwright install chromium`.

### Accessibility tests

The accessibility suite, [`test/renderer-a11y-browser.test.ts`](test/renderer-a11y-browser.test.ts), runs axe-core on a matrix of states of the built renderer, in the light and dark themes. axe-core is a devDependency injected into the page by the tests: it is never part of the report. `npm test` runs it with the rest; on its own:

```sh
npm run build
npx vitest run test/renderer-a11y-browser.test.ts
```

A serious or critical WCAG violation fails the test of its state. The other findings (moderate or minor WCAG violations, best practices, results axe cannot decide) are printed after the run, one line per rule with the states concerned.

**Adding a state** is one line in `MATRIX`: a name, a dataset, a hash, and options: `arrange` (what to do first: open a disclosure or a dialog, switch a mode), `reached` (a selector present once the state shows, waited for before the audit), `width`, `height`, `init` (an init script) and `forcedColors`. The datasets are the renderer sample with generated media files, the cascade of [`test/helpers/cascade.ts`](test/helpers/cascade.ts), and variants built in the test file.

**Accepted findings** go in [`test/a11y-allowlist.ts`](test/a11y-allowlist.ts): each entry is one rule on the elements matching one selector, with the reason it is accepted. A whole rule is never switched off, so a new element breaking the same rule still fails. An entry that matches nothing in a full run fails the run, so a fixed finding must leave the list.

Other accessibility checks: [`test/palette.test.ts`](test/palette.test.ts) (contrast of the tokens and category colours), [`test/renderer-focus-browser.test.ts`](test/renderer-focus-browser.test.ts) (focus and page title on view changes, scroll keys, the sidebar tree, short viewports), [`test/renderer-shell-browser.test.ts`](test/renderer-shell-browser.test.ts) (the page never scrolls, only the sidebar and the content do, whatever the wheel, the keyboard or a focus move does; with classic scrollbars; short viewports scroll the page to the end of the content and no further) and [`test/renderer-display-modes-browser.test.ts`](test/renderer-display-modes-browser.test.ts) (forced colours, reduced motion).
