# playwright-loupe
Loupe — an HTML reporter for Playwright: a dashboard that shows what failed and why, error groups by normalized signature, tests grouped by project, file and describe block, and dimensions from tags and annotations. Native Playwright APIs only.

> **Status: work in progress — the JSON schema will change before 1.0.**

![Loupe overview](https://raw.githubusercontent.com/qartisan/playwright-loupe/main/docs/images/overview.png)

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

The report is a single self-contained HTML file. It works offline, straight from `file://`, in light and dark themes.

- **Header:** the run's verdict and status counts, its start, duration and environment; the shortcuts and theme controls stay top-right at every width.
- **Overview:** verdict with pass rate, run errors first when the run broke outside its tests, error categories, project cards, and the run details in three groups: Run (scope, CI, workers, shard), Code (commit, short with a copy button; branch; repository) and Environment (Playwright, Loupe, Node, OS). Empty values are left out.
- **Errors:** every error group, built from normalized error signatures, with the failed / flaky split and links to the affected tests. A group page has previous / next buttons: from a category, they stay within that category.
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
- **Suite health:** dimensions from tags and annotations (with hints for unknown or inconsistent values), slowest, skipped and flaky tests.
- **Tests:** every test in one sortable list (by default in declaration order, as in the sidebar: project, file, line; the Status header sorts failed, flaky, passed, skipped), filtered by status, error category, project, tag and dimension, with the count each filter would give. Header counts, error categories and dimension values open it pre-filtered. Large lists show their first 500 rows, with "Show 500 more" and "Show all". Under each title, chips show what the test covers: its dimension values first (dimensions in config order, the value alone, `api`, with the dimension in the tooltip), then its other tags (`@smoke`), sorted. A tag a dimension takes appears only as that dimension's value. A chip adds its value to the filters, keeping the others and the sort; an active chip (with a ×) removes it, and Back undoes either. Up to four chips per row, active chips always among them; "+N" shows the rest.
- **Sidebar:** search (`/` to focus; every word must match, ignoring case and accents, the title path, file, project, tags or dimension values: `smoke`, `api`, `layer:api`), projects, folders, files, `describe` blocks and tests, with status icons, failure counts and keyboard navigation. The folder shared by every file is not repeated.
- **Filters in the URL:** search, filters and sort live in the link, so a filtered view can be shared or bookmarked, even from `file://`. A project without a `name` (Playwright's default project) cannot be selected in the project filter: an empty name cannot be written in the URL. Give your projects a name to filter by them. Each tag is filterable in one place only: a tag a dimension is built from (`@layer:ui` with a `layer` dimension, configured or automatic) is in that dimension's filter (Layer: `ui`), not in the tag filter, so the two can never be combined into an empty result. Unprefixed tags (`@smoke`) and prefixed tags no dimension uses stay in the tag filter.

### Keyboard shortcuts

| Key | Action | Where |
| --- | --- | --- |
| `j` / `k` | Next / previous test | Test detail |
| `[` / `]` | Previous / next attempt | Test detail |
| `n` / `p` | Next / previous error group | Error group page |
| `←` / `→` | Previous / next screenshot | Screenshot viewer |
| `/` | Focus the search | Everywhere |
| `Escape` | Clear the search, close a dialog | Everywhere |
| `?` | Show keyboard shortcuts | Everywhere |

Single keys do nothing while typing in a field or with Ctrl, Alt or Meta held, nor while a dialog or the screenshot viewer is open. The keyboard icon in the header opens the same list.

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

### Security

Reports are meant to be shared, so Loupe removes secrets from `report.json` and `index.html` before writing them, replacing each with `[redacted]`:

- **typed values** of `fill`, `type`, `pressSequentially` and `keyboard.*` steps on secret-looking fields (a password field, `getByLabel('Password')`, or a source line that names the value, `fill(password)`), and wherever Playwright repeats them in that attempt's errors;
- **HTTP header values** printed in call logs (`cookie`, `set-cookie`, `authorization`, and any header with a secret-looking name);
- **URL parameters** with a secret-looking name, wherever URLs appear (navigation steps, call logs, error messages): `?token=[redacted]`, `&access_token=[redacted]`;
- the **values of the environment variables you list** in `redact.env` (names only, never values), everywhere in the report. It is also the fallback for what the names above miss: a secret in a URL parameter with a neutral name (`?sig=…`), or printed by your code.

```ts
redact: { env: ['E2E_PASSWORD', 'API_TOKEN'] },
```

**Attachments are not altered**: traces, screenshots and videos contain typed values and visible secrets, so a report with traces must be treated as private. Snippets (source excerpts around errors) are left as they are: they come from your repository. See [Secret redaction](docs/config.md#secret-redaction).

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
| `npm run dev:renderer` | Vite dev server for the renderer, fed with `src/renderer/dev/sample.json`, with hot reload; it serves the sample's attachments at `data/`. No Playwright run needed for UI work. |

Tests that drive a browser need Chromium: `npx playwright install chromium`.
