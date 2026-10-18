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

- **Overview:** verdict with pass rate, run errors first when the run broke outside its tests, error categories, project cards.
- **Errors:** every error group, built from normalized error signatures, with the failed / flaky split and links to the affected tests. A group page has previous / next buttons: from a category, they stay within that category.
- **Test detail:** title path, outcome, project, `file:line`, tags, annotations and dimensions, then one tab per attempt (the last failing attempt first; `?attempt=` in the URL): errors with Expected / Received and diffs highlighted and the code snippet, steps (`test.step` and failing steps, the failing path expanded; "Show all steps" for hooks, fixtures and API calls), attachments listed by kind, stdout and stderr. Previous / next walk the Tests view's current list.
- **Copy buttons:** rerun commands (this test, the failed tests of its file, the failed tests of the current list) and an AI prompt describing the failure, in English. Both are only copied to the clipboard; nothing is sent anywhere. Projects failing on the same lines share one command (`--project=a --project=b`); otherwise each project gets its own, joined with `&&`.
  - The commands target **POSIX shells** (bash, zsh; not `cmd.exe`) and run from the Playwright root directory: paths in the report are relative to it.
  - A `file:line` argument targets the line where the test is declared and reruns every test declared on that line. A command is only valid while the file has not changed since the run.
- **Suite health:** dimensions from tags and annotations (with hints for unknown or inconsistent values), slowest, skipped and flaky tests.
- **Tests:** every test in one sortable list, filtered by status, error category, project, tag and dimension, with the count each filter would give. Header counts, error categories and dimension values open it pre-filtered. Large lists show their first 500 rows, with "Show 500 more" and "Show all".
- **Sidebar:** search (`/` to focus), projects, folders, files, `describe` blocks and tests, with status icons, failure counts and keyboard navigation. The folder shared by every file is not repeated.
- **Filters in the URL:** search, filters and sort live in the link, so a filtered view can be shared or bookmarked, even from `file://`. A project without a `name` (Playwright's default project) cannot be selected in the project filter: an empty name cannot be written in the URL. Give your projects a name to filter by them. Each tag is filterable in one place only: a tag a dimension is built from (`@layer:ui` with a `layer` dimension, configured or automatic) is in that dimension's filter (Layer: `ui`), not in the tag filter, so the two can never be combined into an empty result. Unprefixed tags (`@smoke`) and prefixed tags no dimension uses stay in the tag filter.

### Keyboard shortcuts

| Key | Action | Where |
| --- | --- | --- |
| `j` / `k` | Next / previous test | Test detail |
| `[` / `]` | Previous / next attempt | Test detail |
| `n` / `p` | Next / previous error group | Error group page |
| `/` | Focus the search | Everywhere |
| `Escape` | Clear the search, close a dialog | Everywhere |
| `?` | Show keyboard shortcuts | Everywhere |

Single keys do nothing while typing in a field or with Ctrl, Alt or Meta held. The keyboard icon in the header opens the same list.

### Coming next

- Media viewers in the test detail: screenshot comparison (side-by-side, slider, overlay, diff), video player, trace viewer.

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
| `npm run dev:renderer` | Vite dev server for the renderer, fed with `src/renderer/dev/sample.json`, with hot reload; it serves the sample's attachments at `data/`. No Playwright run needed for UI work. |

Tests that drive a browser need Chromium: `npx playwright install chromium`.
