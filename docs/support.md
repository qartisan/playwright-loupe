# Supported Playwright versions

Which Playwright versions Loupe supports, what installing Loupe does to your Playwright version, and where a new Playwright release can degrade the report. The README gives the short version: [Supported Playwright versions](../README.md#supported-playwright-versions).

## Policy

Loupe supports every Playwright minor version released in the twelve months before a Loupe release. A minor version counts from the date of its `x.y.0` release; patches do not count.

The **supported floor** is the oldest supported version. It may stay older than the twelve-month window, never newer: it is the oldest minor version released within the window, or an older one. It is raised only in a minor release of Loupe (`0.x.0` while Loupe is below 1.0), announced in the [CHANGELOG](../CHANGELOG.md). Versions about to leave the window get no warning during runs.

A Playwright 2.0 is not accepted until it has been checked: the peer dependency range stops below 2.

## Two floors

| | Version | Meaning |
| --- | --- | --- |
| Supported floor | **1.57** | The policy above. Tested in CI on every push; no warning. |
| Minimum installable (technical floor) | **1.52** | The lower bound of the peer dependency, `^1.52.0`. The oldest version on which Loupe runs without throwing and without leaking secrets, tested in CI on every push. From 1.52 to 1.56, Loupe writes a warning at the start of the run. |

Both values are defined once, in [`src/core/support.ts`](../src/core/support.ts) (`MIN_PLAYWRIGHT_SUPPORTED`, `MIN_PLAYWRIGHT_INSTALLABLE`). Tests keep the peer dependency of `package.json`, the CI jobs and the README in line with them, and the technical floor at or below the supported floor.

The technical floor is raised only when it must be: code that cannot run on it, a CI image that disappears, or secret redaction that cannot be kept working on it. Such a raise is announced prominently in the CHANGELOG, because installing Loupe can then change the Playwright version of older projects (see below).

## What installing Loupe does to Playwright

`@playwright/test` is a peer dependency of Loupe: Loupe uses the Playwright of your project.

- **Playwright 1.52 or later**: installing or upgrading Loupe does not change your Playwright version.
- **Below 1.52**, npm does one of two things:
  - with a caret range in your `package.json` (`^1.50.0`), it upgrades Playwright within that range, silently, to satisfy the peer dependency;
  - with an exact version (`1.50.0`) or a tilde range (`~1.50.0`), it refuses to install, with `ERESOLVE`.

  `npm install --legacy-peer-deps` installs anyway, but `npm ls` then reports an invalid tree, and a later plain `npm ci` fails with `ERESOLVE`.

Upgrade Playwright deliberately first, then install Loupe. After any Playwright upgrade, check the lockfile diff and run `npx playwright install`, so the browsers match the new version.

## Run-time warning

When the reporter starts and Playwright is below the supported floor, Loupe writes one line to stderr:

```
Loupe: Playwright 1.55.0 is below the minimum supported version (1.57). The report is generated, but some data may be missing or wrong. See https://github.com/qartisan/playwright-loupe/blob/main/docs/support.md
```

The run carries on normally: the exit code and the report are unchanged. Major and minor numbers are compared, so `1.57.0-alpha-…` counts as 1.57. A missing or unreadable version gives no warning, and no version is too new for a warning.

Under `merge-reports`, the version judged is the one recorded in the blob reports, the Playwright that ran the tests and produced the data.

## Features of newer Playwright versions

Loupe uses these when they are available, without raising the floors.

| Playwright feature | Since | Without it |
| --- | --- | --- |
| `workerInfo` passed to `onError` | 1.60 | A run error from a worker (a worker fixture failing in teardown) has no project: `project` is `null`. |
| `config.argv` | 1.61 | Run scope reads `process.argv`, the same `playwright test` command line when Playwright runs from its CLI. |
| `TestStep.subtitle` | 1.63 | `Step.subtitle` is `null`, and the target of an action is part of the step title. Secret redaction reads the target from the title. |
| `serial` annotation on `describe.serial` tests | 1.63 | No `serial` annotation; a test that did not run because an earlier test of its group failed still gets the generic skip reason. |
| `config.filteredProjects` | 1.64 | `--project` is detected from the command line and the projects present in the run. |
| `default: false` on a project | 1.64 | Does not exist before 1.64. On 1.64 and later, Loupe reads it from Playwright's internal config; if that ever stops working, a plain run is still `full`, but with `--project` every configured project is the reference ([Default projects](schema/v1.md#default-projects)). |

## Where a Playwright change can degrade the report

### Parsed messages

Loupe reads some of Playwright's text output. If Playwright changes one of these formats, Loupe still writes the report, but that part of it degrades. The `latest` job of CI and the weekly job run the test suite against the latest Playwright release; the last column says which test fails when the format changes.

| Format | Used in | What degrades | Test that detects a change |
| --- | --- | --- | --- |
| Input step titles: `Fill "<value>"`, `Type "<value>"`, `Insert "<value>"`, the target after the value (1.53 to 1.62), `locator.fill(<value>)` (1.52) | [`src/core/redact.ts`](../src/core/redact.ts) | **Secret redaction** of typed values | `test/fixtures.integration.test.ts`, "redacts a value typed into a password field…", for `fill` only. The other titles are unit-tested on titles copied from Playwright; no real run detects a change in them. |
| `Call log:`, the start of Playwright's action log | [`src/core/signature.ts`](../src/core/signature.ts) | Error signatures would keep the call log: one error could split into several groups | None. |
| The `toBeOK()` matcher line: `expect(received).toBeOK()` (1.52), `expect(response).toBeOK() failed` (1.64) | `src/core/signature.ts` | The response status would leave the signature: a 429 and a 503 would share a group | None: the categories still match the status in the call log, and no test compares those signatures on a real run. |
| Test timeout messages (`Test timeout of <n>ms exceeded.` and the hook and fixture variants) | [`src/renderer/secondary.ts`](../src/renderer/secondary.ts), the built-in `Timeout` category | Errors raised after a test timeout are no longer folded; timeouts lose their category | `test/fixtures.integration.test.ts`, "raises a further error after the test timeout…" and "puts one failure in each built-in category". |
| The `(<tags>) ` prefix `merge-reports` adds to run errors (1.57 and later) | `src/core/signature.ts` | A merged run error gets another signature, and `^`-anchored category rules miss it | `test/load-error.integration.test.ts`, "keeps the signature when merge-reports prefixes the error with the shard tag". |
| Node's ESM error, `Cannot find module '…' imported from …` | [`src/core/runErrors.ts`](../src/core/runErrors.ts) | A load error in an ES module spec file loses its file and line (`<anonymous>:1:1`) | `test/load-error.integration.test.ts`, "records the load error in run.errors, with its file and location". |
| Built-in category rules (`strict mode violation`, `element(s) not found`, HTTP statuses, network errors, `expect(` failures, timeouts) | [`src/core/categories.ts`](../src/core/categories.ts) | Failures fall into another category, or `Uncategorized` | `test/fixtures.integration.test.ts`, "puts one failure in each built-in category": one real failure per category, so one wording each. |

### Playwright internals

A few things are not in Playwright's public reporter API, so Loupe reads Playwright internals for them: the `_only` flag (`test.only`), `default` through the internal config (default projects), the `_mode` and `configDir` reporter options (`merge-reports`, git lookup) and `metadata.actualWorkers`. A missing or reshaped internal never makes the reporter throw; the report is written with less precise data. `test/internals.integration.test.ts` removes or reshapes each of them on every CI job. On the latest Playwright, `test/scope.integration.test.ts` (`test.only`, `default`) and `test/git.integration.test.ts` (`_mode`) fail if one disappears.

## Known Playwright issues

Problems in Playwright itself that affect the report, on some versions only.

- **Wrong test lines on Playwright 1.53 to 1.57, in ES module packages.** Playwright can run a test file before it has registered the file's source map. The tests of that file then get lines of the compiled file, further down than the real ones (`basics.spec.ts:49` for a test declared on line 34). It happens on every run under Node.js 24, and intermittently under Node.js 22 when the machine is loaded. CommonJS packages are not affected. Fixed in Playwright 1.58: use Playwright 1.58 or later.
- **Wrong test lines when several Playwright runs start at the same time on one machine, on Playwright 1.56 to at least 1.64**, in ES module and CommonJS packages. When the runs share a cold or changed transform cache (parallel shards on one runner, a monorepo tool running several projects, an IDE run during a terminal run), a run that compiles a file deletes the source map another run has just written, and that run reports lines of the compiled file. Playwright does not support concurrent runs on one machine ([microsoft/playwright#43601](https://github.com/microsoft/playwright/issues/43601)). As advised there, give each concurrent run its own cache folder with the `PWTEST_CACHE_DIR` environment variable (undocumented).

  In both cases, only the lines of tests were wrong in our measurements: the test location (`file:line:column`) and what Loupe builds from it, the rerun command (`npx playwright test basics.spec.ts:49` then finds no test, or reruns another one), the location in the AI prompt and the sort by location. Test ids, step locations and error locations were right, and so was secret redaction, which reads the source line of a step, not of a test. Loupe cannot correct these lines: the reporter loads after the test files, and Playwright gives it locations already computed.
- **On Playwright 1.53 and 1.54, `type` and `pressSequentially` values in call logs.** Their step titles carry no value (`Type getByLabel('Password')`), but a failing call prints it in its call log (`elementHandle.type("<value>")`). Loupe cannot tell it is a value, so it cannot redact it. Use `fill`, or Playwright 1.55 or later.
- **Playwright 1.52 hangs on Node.js 24.17, in ES module packages.** `playwright test` never exits, even for a single passing test with the built-in `list` reporter and without Loupe. Node.js 24.11.1 is not affected, nor are CommonJS packages, nor Playwright 1.53 or later. With Playwright 1.52, use Node.js 22, or upgrade Playwright.

Whatever the version, **attachments are never redacted**: traces, screenshots and videos contain typed values and visible secrets, and traces keep absolute paths. A report with traces must be treated as private. See [Secret redaction](config.md#secret-redaction).
