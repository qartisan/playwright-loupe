# Loupe run history — history v1

The run files Loupe writes under `<history dir>/runs/`, and the history block it embeds in `index.html`. This is Loupe's second public contract, versioned on its own by `historyVersion`, independent from the report's [`schemaVersion`](v1.md#versioning-policy). What is recorded and when is described in [`docs/history.md`](../history.md).

The TypeScript types are the source of truth: [`src/schema/history-v1.ts`](../../src/schema/history-v1.ts) (`HistoryRunFile`, `EmbeddedHistory`).

## Conventions

- Dates are ISO 8601 strings in UTC (`2026-11-10T14:02:11.408Z`); durations are integers in milliseconds.
- Text taken from the report (titles, extracts, locations) is already [redacted and path-rewritten](v1.md#paths-in-text), as in `report.json`.
- Short keys (`t`, `o`, `a`, `f`, `x`) are used for the fields repeated once per test or failure, to keep files small.

## Versioning policy

- **`historyVersion`** is the format of the run file: `1`. Adding an optional key that older readers can ignore keeps it. Any other change of shape or meaning bumps it, and readers keep a reader for every older version.
- A reader **skips a file with a newer `historyVersion`**, with one warning; it never rewrites it. A file it cannot decompress or parse, or whose required fields are missing or of the wrong type, is corrupt: skipped, with the same single warning.
- Keys a reader does not know are ignored, so an optional key added later is read as before.
- **`signatureVersion`** is the version of the [error signature](v1.md#error-signature) algorithm the file was written with ([below](#signature-version)). Signatures of different versions are never compared; statuses still are.
- The embedded block has its own version, `v` ([below](#embedded-history)).

## Files

```
<history dir>/
  .gitignore                                   # *, written when Loupe creates the folder
  runs/
    <startedAt>-<stream hash>-<run id>.json.gz
```

| Part | Format |
| --- | --- |
| `startedAt` | `run.startedAt` in compact UTC, without `-` and `:`: `20261110T140211.408Z`. Names sort by time. |
| `stream hash` | 8 lowercase hex characters: the first 8 of the SHA-256 of `run.stream` as JSON, its entries sorted by key (`[["environment","staging"],["origin","ci"]]`). The order of `stream.key` does not change it. |
| `run id` | `run.id`: letters, digits, `.`, `_` and `-`, starting with a letter or a digit. |

The full name matches `^(\d{8}T\d{6}(\.\d{3})?Z)-([0-9a-f]{8})-([A-Za-z0-9][A-Za-z0-9._-]*)\.json\.gz$`. Anything else in `runs/` is not a run file: readers ignore it. Loupe's temporary files start with `.` and end with `.tmp`.

The content is **gzipped JSON** (UTF-8, minified, any compression level), written to a temporary file in `runs/`, then renamed. Readers refuse a file that decompresses to more than 64 MB (a real file is about 1 MB at 5,000 tests): it is corrupt.

Read one by hand:

```sh
zcat loupe-history/runs/<file>.json.gz | jq .
node -e "const f=require('fs'),z=require('zlib');console.log(JSON.stringify(JSON.parse(z.gunzipSync(f.readFileSync(process.argv[1]))),null,2))" loupe-history/runs/<file>.json.gz
```

## HistoryRunFile

| Field | Type | Notes |
| --- | --- | --- |
| `historyVersion` | `1` | |
| `signatureVersion` | `number` | Version of the signature algorithm. `6` today. |
| `loupeVersion` | `string` | The Loupe that wrote the file. |
| `playwrightVersion` | `string` | As `run.playwrightVersion` in the report. |
| `run` | `HistoryRun` | |
| `tests` | `HistoryTest[]` | In the report's order. |

## HistoryRun

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | The run id: `<ci provider>-<ci run id>-<content hash>`, `merge-<content hash>` or a random UUID ([Run id](../history.md#run-id)). The key of later notes and exclusions. |
| `reportRunId` | `string` | `run.id` of the report written by the same run (a random UUID): the link to that report. |
| `startedAt` | `string` | The earliest shard's start for a merged run. |
| `durationMs` | `number` | |
| `status` | `string` | As the report's `run.status`. |
| `origin` | `'local' \| 'ci' \| 'ide'` | [Origins](../history.md#origins). |
| `environment` | `string` | `environment` / `LOUPE_ENV`, `default` when unset. |
| `stream` | `object` | The parts of the configured stream key, in the configured order: `environment` and `origin` as above, `branch` a string or `null` when not known. |
| `scope` | `'full' \| 'partial'` | As the report's `run.scope`. |
| `scopeReasons` | `string[]` | As the report's `run.scopeReasons`. |
| `merged` | `boolean` | Written by `merge-reports`. |
| `excluded` | `{ reason: string } \| null` | Set at launch with `LOUPE_EXCLUDE`; the reason is trimmed, masked like the report, at most 200 characters. |
| `ciProvider` | `string \| null` | As the report's `run.environment.ciProvider`. |
| `git` | `{ commit: string \| null, branch: string \| null }` | As the report's `run.git`, without the remote. |
| `stats` | `{ total, passed, failed, flaky, skipped }` | As the report's `run.stats`. |
| `projects` | `{ name: string, retries: number }[]` | |
| `errors` | `HistoryError[]` | Errors outside tests (`run.errors`). |

## HistoryError

| Field | Type | Notes |
| --- | --- | --- |
| `sig` | `string` | Error signature. |
| `cat` | `string \| null` | Error category. |
| `x` | `string` | Extract of the message ([below](#extracts)). |
| `at` | `string \| null` | `file:line:column`, null when unknown. |

## HistoryTest

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | The report's [test id](v1.md#test-id). |
| `r` | `number` | `repeatEachIndex`, only when not 0. `(id, r)` is unique in a file. |
| `t` | `string[]` | Label: project, file, `describe()` titles, test title. |
| `o` | `string` | Outcome: `P` passed, `F` failed, `K` flaky, `S` skipped. |
| `d` | `number` | Duration of all attempts. |
| `a` | `string` | One status per attempt: `P` passed, `F` failed, `T` timed out, `S` skipped, `I` interrupted (`FFP`). Omitted for a single attempt that passed in a passed test, or was skipped in a skipped test. |
| `f` | `HistoryFailure[]` | The failed attempts: those that did not end as expected and were not skipped, the failed attempts of a flaky test included. Omitted when none. |

## HistoryFailure

| Field | Type | Notes |
| --- | --- | --- |
| `i` | `number` | Attempt index. |
| `sig` | `string[]` | Signatures of the attempt's errors; empty when it failed without an error (an unexpected pass of `test.fail()`). |
| `cat` | `string \| null` | Category of the first error. Omitted when there is no error. |
| `x` | `string` | Extract of the first error. Omitted when there is no error. |
| `at` | `string \| null` | Location of the first error. Omitted when there is no error. |

### Extracts

An extract is the start of the error message as it is in `report.json`: whole when it has 300 characters or fewer; otherwise cut at the last line end before the 300th character when that keeps at least 120, else at 300 (never in the middle of a surrogate pair). Since the message is already redacted and path-rewritten, an extract can only drop characters, never reveal one. Readers replay the current redaction on extracts and exclusion reasons before using them ([Privacy](../history.md#privacy)).

## Signature version

Every change that can change an error signature bumps `signatureVersion`, with a CHANGELOG note. `test/history-signature-version.test.ts` pins the signatures of a corpus for each version and fails when they change and the number does not. Versions were numbered after the fact for the releases before history existed:

| Version | From Loupe | Change |
| --- | --- | --- |
| 1 | 0.0.1 | Base: ANSI codes and call log removed; UUIDs, URLs, dates, paths, durations, hex strings and numbers replaced; the `merge-reports` tag prefix of run errors removed. |
| 2 | 0.0.2 | E-mail addresses become `<email>`; cuid-like and nanoid-like ids become `<id>`. |
| 3 | 0.0.3 | Stable part of Playwright messages only: strict mode element list and count dropped; locator assertions keep their `Error:`, `Locator:`, `Expected…` and `Received…` lines. |
| 4 | 0.0.5 | UUIDs glued to a prefix (`evt_<uuid>`) replaced. |
| 5 | 0.1.2 | HTTP status codes kept in an HTTP context (with a wider context); secrets redacted before the signature is computed. |
| 6 | 0.1.3 | The final response status of `toBeOK()` kept. |

The path rewriting of 0.1.8 and 0.2.1 changed no signature: they are computed from the original text. A signature also depends on the project's `redact` configuration, which no version covers: adding a variable to `redact.env` changes the signature of messages containing its value.

## Embedded history

`index.html` carries a third data block, next to the [renderer settings](v1.md#renderer-settings) and the report data:

```html
<script id="loupe-history" type="application/json">{"v":1,…}</script>
```

It is derived from the run files read when the run starts, **never from the run itself**, and is **not in `report.json`**, whose shape does not change. It is `null` when there is no history: off, empty, or not derived (one warning). When run files exist but none of the window could be used (written by a newer Loupe, corrupt), it is a block with no run and `skipped` above 0, not `null`, so the report can say why. It is written with the same safe serialisation as the other blocks. The renderer reads only this block, never `loupe-history/`; what it shows is described in [In the report](../history.md#in-the-report).

Statuses are one character per test and run, aligned with the report's `tests`, so no test id is repeated; signatures are indexes into one dictionary.

### EmbeddedHistory

| Field | Type | Notes |
| --- | --- | --- |
| `v` | `1` | Version of the block. |
| `include` | `'full' \| 'all'` | `history.include`: whether partial, excluded and `ide` runs count in run-level statistics. |
| `signatureVersion` | `number` | The current run's. |
| `stream` | `object` | The current run's stream, as `HistoryRun.stream`. |
| `current` | `{ origin, excluded }` | What the report does not say about the current run: its [origin](../history.md#origins) (`stream` holds it only when the key has `origin`) and its exclusion reason, masked as in the run file, `null` when it is not excluded. Its scope is the report's `run.scope`. |
| `skipped` | `number` | Run files of the window that could not be used: written by a newer Loupe, corrupt, or unreadable. The window is that much shorter. A file removed by another run's retention since the listing is not counted. |
| `runs` | `EmbeddedRun[]` | The window: the newest runs of the current stream, at most 20, **oldest first**. Run `k` is column `k` of `cells`. A merge job re-run does not find its own earlier file in it. |
| `cells` | `string` | `cells[test * runs.length + run]`: the outcome code (`P`, `F`, `K`, `S`) of report test `test` in run `run`, or `-` when that run has no result for it. |
| `failures` | `number[][]` | For each test with an `F` or `K` cell: `[test, sig, sig, …]`, one index into `signatures` per `F` or `K` cell, in run order. The signature of a cell is the first error of its first failed attempt; `-1` when there is none to compare (no error, or a run of another signature version). |
| `failureAttempts` | `string` | The attempts (as `HistoryTest.a`) of every `F` or `K` cell, in the order of `failures`, separated by spaces: `FF FP TF`. |
| `attempts` | `[test, run, attempts][]` | The attempts of the other cells, only when the code does not imply them (a single `P` for `P`, a single `S` for `S`): an expected failure, a pass after a retry of another kind. |
| `signatures` | `[signature, category, extract][]` | The signatures of the window's failures, most recently seen first. Only the first 300 have their extract; the others have `null`. |
| `others` | `EmbeddedOtherRun[]` | The newest run of every other stream, newest first. |

### EmbeddedRun

| Field | Type | Notes |
| --- | --- | --- |
| `id`, `reportRunId`, `startedAt`, `durationMs`, `status`, `origin`, `scope`, `scopeReasons`, `stats` | | As in `HistoryRun`. |
| `excluded` | `string \| null` | The exclusion reason. |
| `commit`, `branch` | `string \| null` | From `HistoryRun.git`. |
| `projects` | `[name, retries][]` | The retries of each project of the run, from `HistoryRun.projects`: whether a pass on retry was possible in that run. |
| `sameSignatures` | `boolean` | False when the run has another `signatureVersion`: its statuses compare, its signatures do not. |

### EmbeddedOtherRun

| Field | Type | Notes |
| --- | --- | --- |
| `stream` | `object` | That stream. |
| `id`, `startedAt` | `string` | Of its newest run. |
| `cells` | `string` | One outcome code per report test, or `-`, as a column of `cells`. A test missing from that run is `-`, even when an older run of that stream has it. |
