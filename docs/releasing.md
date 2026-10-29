# Releasing Loupe

The maintainer procedure for publishing `@qartisan/playwright-loupe` to npm. Claude Code prepares the CHANGELOG, regenerates the README screenshots when the UI visibly changed, and runs the read-only checks (steps 1, 3, 4 and 6); the maintainer runs everything that commits, tags, pushes or publishes. Steps marked *maintainer only, not verified by Claude Code* were not run while writing this document.

In the commands, `<version>` is the version being released (for example `0.1.7`) and `<previous>` the last published one (`0.1.6`).

## Steps, in order

1. **Prepare the CHANGELOG** (Claude Code, left in the working tree).
2. **Commit and push** `docs: prepare <version>` to `main`.
3. **Wait for CI**: the six jobs of `.github/workflows/ci.yml` must be green: `Node 22 · Playwright current / Checks` and `Node 24 · Playwright current / Checks` (the lockfile Playwright), `Node 22 · Playwright 1.52.0 (minimum installable) / Checks`, `Node 22 · Playwright 1.57.0 (minimum supported) / Checks`, `Node 24 · Playwright latest / Checks`, and `Demo suite`. A red job, even for an environment reason, stops the release (see [A CI job is red](#a-ci-job-is-red-for-an-environment-reason)). **If the UI visibly changed** since the last release, regenerate the README screenshots from this run, commit, push and wait for CI again (see [below](#3-readme-screenshots-when-the-ui-visibly-changed)).
4. **Pre-flight checks** (read-only); for a minor release, also the [supported Playwright floor](#supported-playwright-floor-minor-release).
5. **Bump the version**: `npm version patch -m "chore: release %s"` (or `minor`).
6. **Check the tag.**
7. **Check the package content**: build, then `npm pack --dry-run`.
8. **Tarball install trial.**
9. **`npm whoami`**, then **`npm publish`**, then check the package page.
10. **`git push --follow-tags`**, then **`npm view`**, then install the new version in a consumer project.

The version-bump commit (step 5) is not tested by CI before publication, since it is pushed after `npm publish`. This is accepted: it only changes the `version` field of `package.json` and `package-lock.json`, and the commit before it passed CI.

## 1. Prepare the CHANGELOG

In `CHANGELOG.md`:

- `## [Unreleased]` becomes `## [<version>] - <YYYY-MM-DD>` (ASCII hyphen), under a new empty `## [Unreleased]`.
- When the JSON shape is unchanged, the entry opens with "No change to the JSON shape: `schemaVersion` stays 1." A change in how signatures are computed always gets a note, even though it keeps `schemaVersion`.
- At the bottom, `[Unreleased]` compares from the new tag, and a new line above the previous version's compares the two tags:

```
[Unreleased]: https://github.com/qartisan/playwright-loupe/compare/v<version>...HEAD
[<version>]: https://github.com/qartisan/playwright-loupe/compare/v<previous>...v<version>
```

The CHANGELOG is committed before `npm version`: `npm version` refuses to run with changes to tracked files, and the tag must contain the new heading.

## 3. README screenshots (when the UI visibly changed)

Skip this step when the views look the same as in the current images (`docs/images/`). The images come from a report built in CI: a report built locally holds local paths in its stack traces, and `npm run demo:screenshots` refuses it.

1. Download the `demo-report` artifact of the green **Demo suite** job of the run above into `demo-report/` (replacing any local one): from the run's page on GitHub, or *maintainer only, not verified by Claude Code*:

   ```sh
   rm -rf demo-report
   gh run download <run-id> --name demo-report --dir demo-report
   ```

2. Regenerate the images (Claude Code can run this, and leaves them in the working tree):

   ```sh
   npm run demo:screenshots
   ```

   It writes `docs/images/<view>-light.png` and `<view>-dark.png` for the five views, and overwrites `overview.png` with the light Overview. Never delete or rename an image: the README of published versions points at `main`.
3. Look at the images, then commit `docs: refresh the README screenshots`, push, and wait for CI again before step 4.

## 4. Pre-flight checks

Run from the repository root, after CI is green. Each command is read-only (`git fetch` only updates remote-tracking refs).

| Check | Command | Expected |
| --- | --- | --- |
| Tracked tree clean | `git status --porcelain --untracked-files=no` | No output |
| `main` matches `origin/main` | `git fetch origin && git rev-parse main origin/main` | Two identical hashes |
| No prerelease suffix | `node -p "require('./package.json').version"` | `<previous>`, no `-dev.N`, equal to `npm view @qartisan/playwright-loupe version` |
| Same in the lockfile | `node -p "const l = require('./package-lock.json'); l.version + ' ' + l.packages[''].version"` | `<previous> <previous>` |
| CHANGELOG headings | `grep -n -e '^## \[Unreleased\]$' -e '^## \[<version>\] - ' CHANGELOG.md` | Two lines, `[Unreleased]` first |
| CHANGELOG links | `grep -cF -e '[Unreleased]: https://github.com/qartisan/playwright-loupe/compare/v<version>...HEAD' -e '[<version>]: https://github.com/qartisan/playwright-loupe/compare/v<previous>...v<version>' CHANGELOG.md` | `2` |
| Tag free, locally and on GitHub | `git tag -l v<version>` and `git ls-remote --tags origin v<version>` | No output |
| Typecheck, build, tests | `npm run typecheck && npm test` (`npm test` builds first) | Exit 0; needs Chromium (`npx playwright install chromium`) |
| Bundle size | The `renderer bundle:` line of the build | No `close to its size budget` warning |

**The dev-version trap.** Trying a local build in a consumer project uses a prerelease version (`npm version prerelease --preid=dev --no-git-tag-version`). It is never committed and must be reverted in both `package.json` and `package-lock.json` before a release; the two version checks above catch it.

The size budget is enforced by the `loupe:inline-assets` plugin of `vite.config.ts` during `vite build`, not by a test: a warning above 100,000 bytes gzip, a failed build above 150,000 bytes.

### Supported Playwright floor (minor release)

Before a minor release, check the supported floor (`MIN_PLAYWRIGHT_SUPPORTED` in `src/core/support.ts`) against the policy of [`docs/support.md`](support.md): it must not be newer than the oldest Playwright minor version released in the twelve months before the release. List the `x.y.0` releases of that window from the npm `time` field:

```sh
npm view @playwright/test time --json | node -e "const t = JSON.parse(require('fs').readFileSync(0, 'utf8')); const from = new Date(); from.setFullYear(from.getFullYear() - 1); for (const [v, d] of Object.entries(t)) if (/^\d+\.\d+\.0$/.test(v) && new Date(d) >= from) console.log(v, d.slice(0, 10))"
```

The first line is the newest version the floor may be raised to. Raising it is optional: the floor may stay older than the window. A patch release never raises it. A raise changes code, so run this check when starting a minor release, before step 1, and again here. To raise the floor:

- change `MIN_PLAYWRIGHT_SUPPORTED`; `test/support.test.ts` then fails until the README badge and line, the tables of the README and `docs/support.md`, and the `minimum supported` job of `ci.yml` show the new version;
- search the repository for the old version and update what describes the floor (not what describes Playwright's own behaviour);
- add a **Changed** entry to the CHANGELOG naming the new minimum supported version.

## 5. Bump the version

```sh
npm version patch -m "chore: release %s"   # or minor
```

Patch for fixes and improvements, minor for a new version line. This updates `package.json` and `package-lock.json`, commits them as `chore: release <version>` and creates the annotated tag `v<version>` (npm's default `v` prefix, unsigned). No `preversion`, `version` or `postversion` script is defined.

If the tag already exists, `git tag` fails; whether `npm version` then leaves its commit behind is *maintainer only, not verified by Claude Code*. The pre-flight tag check avoids the case.

## 6. Check the tag

```sh
git show v<version>:CHANGELOG.md | grep -n '^## \[<version>\] - '
git show v<version>:package.json | grep '"version"'
```

Expected: one heading line, and `"version": "<version>",`. If the heading is missing, the CHANGELOG was not committed before the bump: undo the bump (see [If something goes wrong](#if-something-goes-wrong)) and start again from step 2. Tags `v0.0.6`, `v0.1.1`, `v0.1.5` and `v0.1.6` were created this way; they stay as they are. Tag `v0.1.8` has no version heading either: 0.1.8 was published with its entries still under `## [Unreleased]`, and its heading was added when 0.1.9 was prepared.

## 7. Check the package content

```sh
npm run build
find src licenses -type f -newer dist/index.js
npm pack --dry-run
```

`find` must print nothing: `npm pack` packs `dist/` as it is on disk and does not rebuild it (no `prepack` or `prepare` script, and `prepublishOnly` does not run on `pack`). The listing must contain only `CHANGELOG.md`, `LICENSE`, `README.md`, `dist/**`, `licenses/DM-Sans-OFL.txt` and `package.json`, and show `version: <version>`. For reference, 0.1.6 had 60 files, 166.7 kB packed. `docs/` is not part of the package.

## 8. Tarball install trial

In an empty directory outside the repository, written `<tmp>` here:

```sh
npm run build
npm pack --pack-destination <tmp>
mkdir -p <tmp>/trial/tests && cd <tmp>/trial && npm init -y
npm install -D @playwright/test <tmp>/qartisan-playwright-loupe-<version>.tgz
```

`<tmp>/trial/playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';
export default defineConfig({ reporter: [['@qartisan/playwright-loupe']] });
```

`<tmp>/trial/tests/trivial.spec.ts` (no browser needed):

```ts
import { test, expect } from '@playwright/test';
test('passes @layer:unit', () => { expect(1 + 1).toBe(2); });
test('fails', () => { expect(1 + 1).toBe(3); });
```

```sh
npx playwright test
```

Expected: exit code 1 (one test fails on purpose), `Loupe report written to loupe-report`, and `loupe-report/` with `index.html`, `report.json` and `data/`. The report data in `index.html` has `schemaVersion` 1 and `generator.version` `<version>`. Remove `<tmp>` afterwards. The tarball goes to `<tmp>`, not the repository root: `*.tgz` is ignored by git, but tarballs left there pile up.

The version is not published yet at this point, so npm installs the tarball; a tarball carrying an already published version may be taken as installed and not reinstalled in a consumer project.

## 9. Publish

*Maintainer only, not verified by Claude Code.*

```sh
npm whoami
npm publish
```

`npm whoami` must print an account that owns the `qartisan` npm organization. `publishConfig.access` is `public`; there is no provenance and no registry override.

Publishing requires two-factor authentication: `npm publish` pauses, prints or opens a URL, and waits for a browser confirmation with a security key; the publish resumes once it is confirmed.

`npm publish` runs `prepublishOnly` (`npm run typecheck && npm run build && npm test`), then packs the **working tree**, not the tag: the tree must still be clean. `npm test` rebuilds through `pretest`, so the build runs twice; this is harmless. Chromium must be installed for the browser tests.

Then check the package page on npmjs.com: the version, the README and the file list.

## 10. Push and check

*Maintainer only, not verified by Claude Code*, except `npm view`.

```sh
git push --follow-tags
npm view @qartisan/playwright-loupe version
```

`git push --follow-tags` pushes the release commit and its annotated tag. `npm view` must print `<version>`. Finally, install `@qartisan/playwright-loupe@<version>` in a consumer project and run its suite.

The tag push also runs `.github/workflows/demo.yml` (**Live demo**), which builds the demo suite from the tag and deploys its report to GitHub Pages. Check that the workflow is green and that the footer of https://qartisan.github.io/playwright-loupe/ shows `v<version>`. Nothing is published to npm from GitHub Actions.

## If something goes wrong

**Before `npm publish`, nothing irreversible has happened.** If nothing has been pushed since the bump, undo the version commit and the tag (*maintainer only, not verified by Claude Code*):

```sh
git tag -d v<version>
git reset --keep HEAD~1
```

Then fix, commit, push, wait for CI and bump again. A `docs: prepare <version>` commit already pushed stays; corrections go in a new commit. Never rewrite pushed history.

**After `npm publish`, never unpublish.** Publish a fixed patch version, and if the bad version must be flagged (*maintainer only, not verified by Claude Code*):

```sh
npm deprecate @qartisan/playwright-loupe@<version> "<reason>, use <fixed version>"
```

## A CI job is red for an environment reason

A runner image change, a registry outage or a browser download failure can turn a job red although the code is fine, as Ubuntu 26.04 did during the 0.1.7 release (Playwright below 1.61 does not know it).

1. **Never publish while a job is red**, even if the published code is not in question.
2. Read the log and identify the cause. Re-run the job once. If it is still red, fix the CI in a separate `ci:` commit, which does not go in the CHANGELOG, and wait for every job to be green before resuming the procedure at the step where it stopped.
3. If the version is already published when a job turns red, fix the CI after the fact with a `ci:` commit. No new release unless the published package itself is affected.

An intermittent failure is not an environment failure until it is explained, and re-running until green is not a fix: the 1.57 job that failed twice on wrong test lines before 0.2.0 was caused by two Playwright races, which also affect user reports (see [Known Playwright issues](support.md#known-playwright-issues)).

## Weekly job on the latest Playwright

`.github/workflows/weekly.yml` (**Weekly latest Playwright**) runs the checks of the `Node 24 · Playwright latest` job every Monday at 05:17 UTC, and on demand from the Actions tab (**Run workflow**). Both use `.github/workflows/checks.yml`. It catches a Playwright release that breaks Loupe even when nobody pushes: a changed message format or internal (see [`docs/support.md`](support.md#where-a-playwright-change-can-degrade-the-report)).

When it turns red:

1. Read the log, and compare `npx playwright --version` in the install step with the last green run: a new Playwright release is the likely cause. If it is an environment failure, re-run it once.
2. Identify the Playwright change, then fix Loupe in a normal commit (`fix:`, with a CHANGELOG entry), with a test that fails without the fix.
3. If published versions of Loupe are affected, release a patch.

GitHub disables a scheduled workflow after 60 days without activity in the repository, and says so on the workflow's page. To re-enable it: Actions tab, **Weekly latest Playwright**, **Enable workflow**; then run it once by hand.

## Raising the technical floor

The technical floor is the lower bound of the `@playwright/test` peer dependency (`^1.52.0`, `MIN_PLAYWRIGHT_INSTALLABLE` in `src/core/support.ts`). Raise it only when it must be: code that cannot run on it, a CI image that disappears, or secret redaction that cannot be kept working on it. A raise:

- changes `package.json` and `package-lock.json`: Claude Code proposes the diff, the maintainer applies it;
- changes `MIN_PLAYWRIGHT_INSTALLABLE` and the `minimum installable` job of `ci.yml` (`test/support.test.ts` checks both against `package.json`), and the README and `docs/support.md`;
- goes in a minor release, with a **prominent** CHANGELOG entry: installing that version of Loupe makes npm upgrade Playwright in projects below the new floor that use a caret range, or refuse to install (`ERESOLVE`) with an exact version or a tilde range.

The technical floor must stay at or below the supported floor.

## Patch release from an older tag

When `main` already holds unreleased work that must not ship yet, and a fix must go out (as for 0.1.9, a secret leak fixed while 0.2.0 was in progress), release the patch from the last tag:

1. Cut a branch at the tag in a separate worktree, so `main`'s working tree is untouched (*maintainer only, not verified by Claude Code*):

   ```sh
   git worktree add -b release/<version> ../playwright-loupe-<version> v<previous>
   ```

2. Commit the fix on that branch, push it and wait for CI (it runs on every branch).
3. Follow the steps above from that worktree and branch: the CHANGELOG, CI, pre-flight (with `release/<version>` in place of `main`), `npm version patch`, publish, then `git push --follow-tags` of the branch.
4. Merge `release/<version>` into `main`. In the CHANGELOG, `main`'s `## [Unreleased]` entries stay above the new `## [<version>]` section, and the link lines at the bottom take the branch's. Then remove the worktree (`git worktree remove ../playwright-loupe-<version>`).

## What a release never includes

- A `*.tgz` in git (ignored by `.gitignore`).
- A report (`loupe-report/`, `blob-report/`, `test-results/`, `playwright-report/`, `loupe-perf/`, all ignored).
- A change to `package.json` or `package-lock.json` made by Claude Code: only `npm version`, run by the maintainer, changes the version.
