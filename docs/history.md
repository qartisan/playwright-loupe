# Run history

Loupe keeps a history of your runs: each run adds one small file to a folder next to your Playwright config, and the next report embeds the recent past of every test it contains. It needs no change to your tests and no configuration: history is on by default, locally and in CI.

Nothing is visible in the report yet. This release records runs, reads them back and embeds the derived data in `index.html`; the views that show it come in a later release.

History is files only: no server, no database, no network call. Turn it off with `history: false` in the [configuration](config.md#history) or `LOUPE_HISTORY=off`.

**History never stops a run and never prevents the report.** Any history problem (an unreadable folder, a corrupt file, a file from a newer Loupe, a permission denied, a file removed by another run) becomes one `Loupe: history: …` line on stderr, and the report is written as without history:

```
Loupe: history: skipped a corrupt run file: runs/20261110T140211.408Z-3fa1c2d4-merge-1a2b3c4d.json.gz. The report is not affected.
```

## What is recorded, and where

```
playwright.config.ts
loupe-history/
  .gitignore          # contains *
  runs/
    20261110T140211.408Z-3fa1c2d4-github-actions-11893456-9c0e1f2a.json.gz
    20261111T081502.017Z-3fa1c2d4-github-actions-11901234-07b3d5e6.json.gz
    20261111T093344.920Z-b81e07aa-6f1c2b9e-8d3a-4c5b-9e7f-1a2b3c4d5e6f.json.gz
```

- **The folder** is `loupe-history/`, in the directory of the Playwright config, outside the report folder (`outputFolder`, which is published and replaced on every run). `history.dir` or `LOUPE_HISTORY_DIR` moves it ([configuration](config.md#history)).
- **`.gitignore`**: when Loupe creates the folder, it writes a `.gitignore` containing `*` inside it, so the history is never committed by accident. Your project's own `.gitignore` is never touched. If you delete that file on purpose (to commit the history), Loupe does not put it back: it only writes it when it creates the folder.
- **One file per run**, `runs/<startedAt>-<stream hash>-<run id>.json.gz`: the start time in compact UTC (so names sort by time), 8 hex characters naming the run's [stream](#streams), and the [run id](#run-id). There is no index file: the names are enough to choose what to read and what to remove.
- **Gzipped JSON**, written atomically (a temporary file in `runs/`, then renamed), so a reader sees a whole file or none. About 90 to 110 kB for a 5,000-test run; 200 runs take about 20 MB.
- `reports/` is reserved for a later release; Loupe creates nothing else in the folder.

Each file holds:

- the versions: `historyVersion` (the format of the file), `signatureVersion` (the [error signature](schema/v1.md#error-signature) algorithm), the Loupe and Playwright versions;
- the run: its id, start time, duration and status, [origin](#origins), environment and stream, [scope](schema/v1.md#run-scope) and its reasons, whether it was [excluded](#excluding-a-run) and why, whether `merge-reports` wrote it, the CI provider, the git commit and branch, the counts, the projects and their retries, the errors outside tests, and the `run.id` of the report written by the same run;
- per test: its id, project, file and title, final status, duration, the status of each attempt, and for each failed attempt (the failed attempts of a flaky test included): its error signatures, and the category, location and an **extract** of its first error: the first lines of the message, about 300 characters, as they appear in the report.

Screenshots, videos, traces, stacks, steps and full messages stay in the report; the history keeps none of them. The format is described field by field in [`schema/history-v1.md`](schema/history-v1.md).

### Reading a run file

With a shell (`gzip -dc` in place of `zcat` where `zcat` only takes `.Z` files, as on older macOS):

```sh
zcat loupe-history/runs/<file>.json.gz | jq .run
```

On any system, Windows included (PowerShell or `cmd`), with Node.js alone:

```sh
node -e "const f=require('fs'),z=require('zlib');console.log(JSON.stringify(JSON.parse(z.gunzipSync(f.readFileSync(process.argv[1]))).run,null,2))" loupe-history/runs/<file>.json.gz
```

Drop `.run` (`jq .`, or `JSON.parse(…)` alone) to see the tests too.

## Origins

Each run gets an origin, recorded in its file:

| Origin | When |
| --- | --- |
| `ci` | A CI is detected, as for `run.environment.ci` in the report ([Git and CI detection](schema/v1.md#git-and-ci-detection)). |
| `ide` | The run comes from the VS Code extension, UI mode or watch mode. |
| `local` | Any other run. |

`ide` is detected from how Playwright was started: the VS Code extension starts `playwright test-server`; UI mode is `--ui`, `--ui-port` or `--ui-host`; watch mode sets `PWTEST_WATCH`. Checked on Playwright 1.52, 1.57, 1.64.1 and 1.65 ([support](support.md#playwright-internals)). A terminal inside VS Code is not an IDE run: `npx playwright test` typed there is `local`. A CI wins over the rest.

`ide` runs are recorded like the others, with their environment, but they are left out of run-level statistics by default ([Statistics](#what-counts-in-statistics)).

## Streams

Runs are compared within a **stream**: by default, runs of the same environment and origin. Your nightly CI runs against `staging` are one stream, your local runs another, so a laptop run never shifts the CI trend.

- The environment is `environment` in the config, or `LOUPE_ENV`; a run without one is in the environment `default`.
- `history.stream.key` chooses what makes a stream: a non-empty list of `environment`, `origin` and `branch`. `['environment', 'origin', 'branch']` keeps each branch apart. A run whose branch is unknown has a `null` branch, a stream of its own.
- The order of the key does not matter, but **adding or removing a part starts new streams**: the runs recorded with the old key are no longer compared with new ones, and they leave with `maxAgeDays` ([Retention](#retention)).

## Retention

Each recorded run then removes old run files. The first limit reached wins:

- **`maxRuns`** (default 200) applies to the run's **own stream**: a run removes the files of its stream beyond the 200 newest. Another stream keeps its runs whatever this one does, so a burst of local runs never pushes out CI runs.
- **`maxAgeDays`** (default 90) applies to **every stream**: a run removes any run file older than 90 days, whatever its stream. That is how the files of an abandoned stream (an old stream key, an environment that is gone) leave.

Both are read from file names alone: Loupe opens no file to prune. The file the run has just written is never removed, even when it is old (a merge of old blobs). Temporary files older than an hour, left by an interrupted run, are removed too. Several runs can write and prune the same folder at the same time: a file another run has already removed is no error.

Retention runs only when a run is recorded. Other files in the folder (anything not named like a run file, plain `.json` files included) are never read and never removed, apart from Loupe's own temporary files.

### Windows file locks

On Windows, a file another process holds open (an antivirus scanning it, the search indexer, a backup tool) cannot be renamed onto or removed for a moment.

- **Writing**: the rename onto an existing file (a merge job re-run) is retried for about a quarter of a second. If the file is still held, the run is not recorded, with one warning.
- **Pruning**: a file that cannot be removed because Windows holds it (`EPERM`, `EACCES` or `EBUSY`) is skipped silently, like a file another run already removed: the next run removes it. This applies on Windows only. Elsewhere these errors mean a real permission problem, which gets the warning. Any other error while pruning gets the warning everywhere.
- **Reading**: a file held while it is read is skipped with a warning, since the report misses one of its past runs.

**A read-only run file is never removed on Windows**: removing it fails with `EPERM`, the same error as a held file, so it is skipped silently at every run. Loupe never makes its files read-only; if you or a tool did, delete the file by hand, or clear the read-only attribute.

## Runs that are never recorded

- **`--list`**: nothing ran.
- **A run where no test ran**: an empty shard, a run stopped before its first test.
- **A shard that writes a blob report** (`--shard` with the `blob` reporter): its tests are recorded once, by `merge-reports`, as one run. The merged run starts at the earliest shard's start.
- **History off**: `history: false` or `LOUPE_HISTORY=off`.

`merge-reports` records the run with the origin and environment of the **merge process**, not of the shards: set `LOUPE_ENV` on the merge job, as on the test jobs, or the merged run lands in the environment `default`.

```yaml
- run: npx playwright merge-reports --config merge.config.ts ./all-blob-reports
  env:
    LOUPE_ENV: staging
```

Partial runs (`--grep`, `--project`, `--last-failed`, …) are recorded, flagged with their scope.

## Run id

The run id is the key of a run in the history. It is:

- in a CI that gives a run id, `<provider>-<CI run id>-<content hash>`, for example `github-actions-11893456-9c0e1f2a`. The CI run id comes from `GITHUB_RUN_ID` (GitHub Actions), `BUILD_BUILDID` (Azure Pipelines), `CI_PIPELINE_ID` (GitLab), `CIRCLE_WORKFLOW_ID` (CircleCI), `BUILD_TAG` (Jenkins), `BITBUCKET_BUILD_NUMBER` (Bitbucket Pipelines), `BUILDKITE_BUILD_ID` (Buildkite) or `TRAVIS_BUILD_ID` (Travis CI);
- for a merge outside CI, `merge-<content hash>`;
- otherwise a random UUID.

The content hash is 8 hex characters over the test ids and their attempts' start times. Re-running only the merge job on the same blobs gives the same id, so it rewrites the same file instead of adding a run; a real re-run of the tests gives another one. The jobs of a matrix sharing one CI run id get different ids.

The run file also keeps the report's own `run.id` (a random UUID, as in `report.json`), the link from a run to its report.

## Excluding a run

```sh
LOUPE_EXCLUDE="staging database restored during the run" npx playwright test
```

The run is recorded as excluded, with that reason (trimmed; an empty value is ignored). It stays in the history and in the report, but no longer counts in run-level statistics. The reason is masked like the rest of the report: a [`redact.env`](config.md#secret-redaction) value or your home directory in it does not reach the file.

Excluding a run after the fact, and comments on runs, come in a later release; they will use the run id as their key.

## What counts in statistics

Every recorded run is a data point for its tests. At the level of runs (pass rate of the stream, run trends), three kinds of runs are left out by default, and flagged:

- partial runs (`scope: 'partial'`);
- excluded runs;
- `ide` runs.

`history.include: 'all'` counts them too. The report does not show statistics yet: the setting is embedded for the views of a later release.

## What the report embeds

`index.html` embeds data derived from the history, never the run files themselves, in its own block, separate from `report.json` (which does not change):

- for each test of the report, its **last 20 results in the current stream**: the status, the outcome of each attempt, and the error signatures of its failures;
- the metadata of those 20 runs (date, status, duration, origin, scope and its reasons, exclusion, commit, branch, counts, retries of each project);
- the origin and exclusion reason of the current run, and how many run files of the window could not be used (written by a newer Loupe, corrupt);
- the **latest result of each test in every other stream**: the status in the newest run of that stream;
- the category and extract of the error signatures of the window, the 300 most recently seen.

The data comes from the runs read when the run starts, never from the run itself. About 38 kB gzipped for a realistic 5,000-test suite. The format is in [`schema/history-v1.md`](schema/history-v1.md#embedded-history).

Limits:

- **Other streams show only their latest run.** A test that is missing from that run (it was filtered out, or added since) shows "no result" for that stream, even when an older run of the stream has a result for it.
- **Signatures are compared within one algorithm version.** When a Loupe release changes how signatures are computed, the runs recorded before it keep their statuses in the window, but their errors are not compared with new ones. The current version is in [`schema/history-v1.md`](schema/history-v1.md#signature-version).
- **Signatures also depend on your redaction.** Adding a variable to `redact.env` changes the signature of the messages that contain its value: those failures look new once.

## Privacy

The guarantee of the report extends to the history: **your home directory and the values of `redact.env` never appear in clear in the run files Loupe writes**, as in `report.json` and `index.html` ([Security](../README.md#security)). The run file is built from the report after it is redacted and its paths rewritten: an extract is a prefix of a message that is already masked.

**The redaction is replayed on read.** Before a report embeds anything read from the history, the extracts and exclusion reasons go through the current redaction again, `redact.env` values and home directory included. A value you add to `redact.env` after a run was recorded is masked in the next report.

**The run files keep what they were written with.** Files written before you added a variable to `redact.env` still hold its value in clear in `loupe-history/`: Loupe never rewrites a recorded run. The report is safe, the folder is not. **When in doubt, delete the history folder**: a later run starts a new one, and nothing else depends on it.

The history folder is meant to stay on the machine or in your CI's cache, not to be published: it is outside the report folder, and its `.gitignore` keeps it out of git.

## Test identity after a restructure

A test is followed across runs by its [id](schema/v1.md#test-id): its project, file, `describe()` titles and title. **Renaming or moving any of them makes a new test**, with no past: the old id stays in the history until retention removes it. There is no rename detection.

## Format versions

The run file has its own version, `historyVersion`, independent from the report's `schemaVersion`. A file with a newer `historyVersion`, written by a later Loupe, is skipped when reading (one warning) and never rewritten. Retention still applies to it, from its name, like any run file. See the [versioning policy](schema/history-v1.md#versioning-policy).

## Keeping the history in CI

On a CI runner, the folder disappears with the job unless it is saved and restored between runs (a cache or an artifact). Recipes for GitHub Actions and Azure Pipelines come with a later release. Until then, the history accumulates on machines that keep their workspace: your own machine, or a self-hosted runner.
