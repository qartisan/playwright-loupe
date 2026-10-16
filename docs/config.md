# Configuring Loupe

Loupe works without any configuration. Options let you name the report, add your own error categories, declare dimensions from tags and annotations, and choose presentation defaults. No option ever requires a change to your tests.

```ts
// loupe.config.ts, next to playwright.config.ts
import { defineConfig } from '@qartisan/playwright-loupe';

export default defineConfig({
  outputFolder: 'loupe-report',
  title: 'My suite',
  environment: 'preview',

  categories: {
    mode: 'extend',
    rules: [
      { name: 'Infra', match: [/ECONNRESET/, /ECONNREFUSED/], color: 'gold' },
      { name: 'Auth', match: /session-token/, on: 'message' },
    ],
    uncategorized: 'Uncategorized',
  },

  dimensions: {
    auto: true,
    definitions: [
      { name: 'Layer', from: 'tag', prefix: 'layer', values: ['api', 'ui', 'e2e'] },
      { name: 'Bug', from: 'annotation', type: 'bug' },
      { name: 'Owner', from: 'annotation', type: 'owner' },
    ],
  },

  screenshots: { defaultView: 'slider' },
  theme: 'system',
});
```

```ts
// playwright.config.ts
export default defineConfig({
  reporter: [['list'], ['@qartisan/playwright-loupe']],
});
```

## Where options come from

Four layers, each one overriding the previous:

**defaults < config file < inline reporter options < environment variables**

- **Config file**: `loupe.config.ts` (see [Lookup](#lookup)).
- **Inline options**: the second element of the reporter entry, `['@qartisan/playwright-loupe', { title: 'Nightly' }]`. They accept every option of the config file, plus `configFile`.
- **Environment variables**: see [Environment variables](#environment-variables).

Merging is done key by key for nested objects (`categories`, `dimensions`, `screenshots`): inline `{ categories: { mode: 'replace' } }` keeps the rules of the config file. **Arrays replace**: inline `categories.rules` replaces the rules of the config file entirely, it does not add to them. An option set to `undefined` is ignored, so `title: process.env.SUITE_TITLE` falls back to the lower layer when the variable is unset.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `outputFolder` | `string` | `'loupe-report'` | Report folder, relative to the Playwright config file's directory. |
| `title` | `string` | `'Loupe report'` | Report title. [Renderer setting](#renderer-settings). |
| `environment` | `string` | none | Written to `run.environment.name`. `LOUPE_ENV` overrides it. |
| `categories.mode` | `'extend' \| 'replace'` | `'extend'` | See [Error categories](#error-categories). |
| `categories.rules` | `CategoryRule[]` | `[]` | Your rules, evaluated in order. |
| `categories.uncategorized` | `string` | `'Uncategorized'` | Name of the bucket for errors no rule matches. |
| `dimensions.auto` | `boolean` | `true` | Keep the automatic dimensions built from prefixed tags. |
| `dimensions.definitions` | `Dimension[]` | `[]` | See [Dimensions](#dimensions). |
| `screenshots.defaultView` | `'side-by-side' \| 'slider' \| 'overlay' \| 'diff'` | `'side-by-side'` | Default view of screenshot comparisons. [Renderer setting](#renderer-settings). |
| `theme` | `'system' \| 'light' \| 'dark'` | `'system'` | Default theme. The viewer can switch it; their choice is remembered in the browser. [Renderer setting](#renderer-settings). |
| `configFile` | `string` | none | **Inline options only.** Config file to load instead of the default lookup, relative to the Playwright config file's directory. |

### Error categories

Every error (test errors, step errors and [run errors](schema/v1.md#runerror)) gets the category of the first rule that matches it. Errors no rule matches go to the uncategorized bucket, which stays visible so that a missing rule shows up.

```ts
categories: {
  mode: 'extend',
  rules: [
    { name: 'Infra', match: [/ECONNRESET/, /ECONNREFUSED/], color: 'gold' },
    { name: 'Auth', match: /session-token/, on: 'message' },
    { name: 'Checkout', match: /^pay/m, on: 'step' },
  ],
}
```

| Rule field | Type | Default | Description |
| --- | --- | --- | --- |
| `name` | `string` | required | Category name. Several rules may use the same name. |
| `match` | `RegExp \| RegExp[]` | required | The rule matches when any pattern matches. The `g` and `y` flags are ignored (they make `RegExp.test` stateful). |
| `on` | `'message' \| 'stack' \| 'step' \| 'all'` | `'all'` | What the patterns are tested against. |
| `color` | palette name or `#rrggbb` | a free palette color | Color of the category's badges and charts: a [palette](#category-palette) name such as `'teal'`, or any `#rrggbb` color. |

**`on` targets.** Each target is tested separately:

- `message`: the error message, ANSI codes stripped. For run errors, without the `(<tags>) ` prefix `merge-reports` adds for a shard config with a `tag` (the same applies to `stack`), so a rule anchored with `^` matches a merged run error too. See [merge-reports](schema/v1.md#merge-reports).
- `stack`: the stack trace.
- `step`: the titles of the failing steps, outermost first, **one per line**: for an `expect` failing inside `test.step('pay')`, the text is `pay\nExpect "toHaveText"`. Use `m` to anchor a pattern on one title (`/^pay$/m`). Errors outside any step, and run errors, have no step text: a `step` rule never matches them.
- `all`: any of the three.

**Modes.**

- `extend` (default): your rules run **before** the built-in rules (locator not found, rate limited, server error, network, assertion, timeout; see [schema docs](schema/v1.md#error-categories)), so they win when both match.
- `replace`: the built-in rules are dropped; only your rules apply.

**Colors.** Built-in categories always keep their palette color (see [schema docs](schema/v1.md#error-categories)). A rule without `color` takes a palette color that no other category **of the report** uses: rules without a color are served in config rule order, each taking the first free color in palette order (the order of the table below, gold last). So the same config with the same categories present always gives the same colors; a color only changes when the set of categories in the report changes (a built-in category that does not appear leaves its color free). The palette has eight colors: when a report shows more categories, colors repeat in palette order. Set `color` for a color that never changes. When several rules share a name, the first explicit `color` wins. In `extend` mode, a rule named like a built-in category (for example `Network`) adds patterns to it, and its `color` recolors it.

#### Category palette

| Name | Reference color | Built-in category |
| --- | --- | --- |
| `blue` | `#466cc8` | Assertion |
| `cyan` | `#0a7da1` | Network |
| `teal` | `#04837c` | Rate limited |
| `violet` | `#8656b7` | Ambiguous locator |
| `magenta` | `#ad4681` | Locator not found |
| `orange` | `#ab5803` | Server error |
| `brown` | `#745f43` | Timeout |
| `gold` | `#b9a542` | — (never built in, given last) |

The uncategorized bucket uses a neutral grey (`#6b6b6b`), not available by name. The palette has no red or green, so a category never reads as a failed or passed test. The report stores the reference color; the HTML report shows each palette color with hand-tuned light and dark shades. A `#rrggbb` color gets shades derived from it, lightened or darkened until text and borders meet WCAG contrast (4.5:1 for text, 3:1 for borders) in both themes, so any color stays readable. An unknown palette name is a config error that lists the valid names.

`categories.uncategorized` must not be the name of a rule.

### Dimensions

A dimension is an analysis axis (layer, module, owner, bug...) built from tags and annotations. Each test gets its values in `tests[].dimensions`; definitions are listed in `dimensions`.

```ts
dimensions: {
  auto: true,
  definitions: [
    { name: 'Layer', from: 'tag', prefix: 'layer', values: ['api', 'ui', 'e2e'] },
    { name: 'Bug', from: 'annotation', type: 'bug' },
  ],
}
```

| Definition field | Type | Description |
| --- | --- | --- |
| `name` | `string` | Dimension name, unique. |
| `from` | `'tag' \| 'annotation'` | Source. |
| `prefix` | `string` | `from: 'tag'` only. Tag prefix without `@` and `:`: `layer` reads `@layer:api`. Unique among tag dimensions. |
| `type` | `string` | `from: 'annotation'` only. Annotation type; the annotation `description` is the value. Unique among annotation dimensions. |
| `values` | `string[]` | Optional. Expected values, recorded in the report so the renderer can show unknown values (typos) and tests missing a value. Loupe does not reject other values. |

- **Automatic dimensions.** With `auto: true`, every tag prefix not claimed by a definition gives a dimension named after the prefix (`@area:checkout` → `area`). `auto: false` keeps only your definitions.
- **Override.** A tag definition takes over the automatic dimension of its prefix: with `{ name: 'Layer', from: 'tag', prefix: 'layer' }`, tests get `Layer`, never `layer`. An automatic dimension whose name is used by a definition is dropped too.
- **Annotation values.** Tests with several annotations of the type get several values. Annotations declared on the test and those added at runtime (`testInfo.annotations.push`) count; an annotation without description gives no value.
- **Listing.** Definitions from the config are always listed in the report, in config order, even when no test uses them. Automatic dimensions follow, sorted by name, when at least one test uses them.

### Renderer settings

`title`, `theme` and `screenshots.defaultView` are presentation choices, not data. They are written next to the report data in `index.html`, not in `report.json`, and are not part of the data contract. See [Renderer settings](schema/v1.md#renderer-settings).

## Environment variables

| Variable | Effect | Relative to |
| --- | --- | --- |
| `LOUPE_CONFIG` | Config file to load, instead of the lookup and of the `configFile` option. | Working directory |
| `LOUPE_OUTPUT_FOLDER` | Overrides `outputFolder`. | Working directory, like Playwright's own `PLAYWRIGHT_*_OUTPUT_DIR` variables |
| `LOUPE_TITLE` | Overrides `title`. | |
| `LOUPE_ENV` | Overrides `environment`. | |
| `LOUPE_RUN_SCOPE` | Forces the run scope: `full` or `partial`. See [Run scope](schema/v1.md#run-scope). | |

Empty values are ignored, as if the variable were unset. An invalid `LOUPE_RUN_SCOPE` stops the run.

## Lookup

Without `LOUPE_CONFIG` or `configFile`, Loupe looks for the first of these files:

1. `loupe.config.ts`
2. `loupe.config.mts`
3. `loupe.config.js`
4. `loupe.config.mjs`

in the **directory of the Playwright config file**. Under `playwright merge-reports`, that is the directory of the merge config passed with `--config`, or the **working directory** when there is none.

No config file is a valid situation: defaults and the other layers apply. An explicit file (`LOUPE_CONFIG`, `configFile`) that does not exist is an error.

The config file must `export default` an object (`module.exports = {...}` works too in CommonJS).

## Validation

The config is validated when Playwright creates the reporter, before any test runs. Each layer is checked on its own so messages name where the problem is:

```
Error: Loupe: invalid configuration.
  - loupe.config.ts: categories.rules[2].match must be a RegExp or an array of RegExp, got "ECONN"
  - loupe.config.ts: titel is not a known option. Did you mean "title"?
  - reporter options: theme must be one of "system", "light", "dark", got "blue"
```

- Every message names the source (`loupe.config.ts`, `reporter options`), the exact path and the expected type.
- **Unknown keys are errors**, with a "did you mean" suggestion when a known key is close (typos, wrong case), or the list of known keys otherwise.
- All problems are reported at once.
- **An invalid config stops the run**, like an invalid `LOUPE_RUN_SCOPE`: Playwright prints the message and exits with a non-zero code without running tests. A config file that fails to load (syntax error, missing import) stops it the same way.
- Playwright adds its own keys to every reporter's options (`configDir`, and internal keys starting with `_`). Loupe ignores them.

## How config files are loaded

The config file is loaded **synchronously, in the reporter constructor**. The constructor is the only point where an error stops the run: Playwright does not wait for `onBegin`, and it swallows errors thrown by later reporter hooks.

Loupe has no TypeScript loader of its own and no dependency for it. It relies on Playwright's: before Playwright builds a reporter that is not built-in, it installs its TypeScript transform (Babel) for the whole process, the same one that loads `playwright.config.ts` and your tests. Loupe then calls `require()` on the config file, which goes through that transform. This works in `playwright test` and in `playwright merge-reports`, with or without `--config`.

It was checked with Playwright 1.52 on Node.js 22 and Playwright 1.64 on Node.js 22 and 24 (latest 22.x and 24.x), in ES module and CommonJS packages, for `.ts`, `.mts`, `.js` and `.mjs` files. Node's own type stripping is not used: it would reject TypeScript-only syntax such as `enum`, which Playwright's transform accepts.

Limits:

- **No top-level `await`** in the config file. ES module output is loaded with Node's `require(esm)`, which does not support it. The error says so.
- `require(esm)` is why Loupe requires **Node.js 22.12 or later** (`engines.node`): earlier 22.x versions cannot load ES module config files.
- **Imports** from the config file follow Playwright's rules: relative `.ts` files can be imported with a `.js` extension, `tsconfig` paths are resolved, and files inside `node_modules` are not transformed (use the compiled package, as with `@qartisan/playwright-loupe` itself).
- **Watch and UI mode** reuse the process: a CommonJS config is reloaded for each run, an ES module config is not (Node caches it). Restart after changing it.
- Outside `playwright test` and `merge-reports` (another tool building Loupe's reporter itself), Playwright's transform is not there: `.js` and `.mjs` files load, and `.ts` files only through Node's own type stripping, when available, which rejects syntax such as `enum`.
