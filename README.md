# playwright-loupe
Loupe — a clear, insightful HTML reporter for Playwright. Project overview, history, flakiness and error categories, using native Playwright APIs only.

> **Status: work in progress — the JSON schema will change before 1.0.**

Loupe is a reporter for Playwright, not affiliated with Microsoft.

## Installation

```sh
npm install --save-dev @qartisan/playwright-loupe
```

Requires Node.js 22 or later and `@playwright/test` 1.52 or later.

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

Loupe requires `@playwright/test` 1.52 or later.

A run that broke outside its tests (a spec file that fails to import, a failing global setup) is reported in `run.errors`, even when no test ran.

## Configuration

Put a `loupe.config.ts` next to `playwright.config.ts`:

```ts
// loupe.config.ts
import { defineConfig } from '@qartisan/playwright-loupe';

export default defineConfig({
  title: 'My suite',
  categories: {
    rules: [{ name: 'Infra', match: [/ECONNRESET/, /ECONNREFUSED/] }],
  },
  dimensions: {
    definitions: [
      { name: 'Layer', from: 'tag', prefix: 'layer', values: ['api', 'ui', 'e2e'] },
      { name: 'Bug', from: 'annotation', type: 'bug' },
    ],
  },
});
```

Options can also be passed inline (`['@qartisan/playwright-loupe', { title: 'Nightly' }]`) and through `LOUPE_*` environment variables. Precedence: defaults < config file < inline options < environment variables. The config is validated at startup: an invalid option, or a typo in a key, stops the run with an explicit message.

Every option, the lookup rules and the environment variables are documented in [`docs/config.md`](docs/config.md).

## Development

| Command | What it does |
| --- | --- |
| `npm run build` | Builds the reporter (`dist/`) and the self-contained renderer template (`dist/renderer/index.html`). |
| `npm run typecheck` | Type-checks the core, tests, fixtures and renderer. |
| `npm test` | Builds, then runs the Vitest unit tests and the integration tests (fixture suite, and a sharded run merged with `merge-reports`). |
| `npm run fixtures` | Builds, then runs the fixture suite into `loupe-report/`. Its failures are intentional, see [`fixtures/README.md`](fixtures/README.md). |
| `npm run sample:update` | Runs the fixture suite and copies its report to `src/renderer/dev/sample.json`. |
| `npm run dev:renderer` | Vite dev server for the renderer, fed with `src/renderer/dev/sample.json`, with hot reload. |

Tests that drive a browser need Chromium: `npx playwright install chromium`.
