# Releasing Loupe

The maintainer procedure for publishing `@qartisan/playwright-loupe` to npm. Claude Code prepares the CHANGELOG and runs the read-only checks (steps 1 and 4); the maintainer runs everything that commits, tags, pushes or publishes. Steps marked *maintainer only, not verified by Claude Code* were not run while writing this document.

In the commands, `<version>` is the version being released (for example `0.1.7`) and `<previous>` the last published one (`0.1.6`).

## Steps, in order

1. **Prepare the CHANGELOG** (Claude Code, left in the working tree).
2. **Commit and push** `docs: prepare <version>` to `main`.
3. **Wait for CI**: the four jobs of `.github/workflows/ci.yml` must be green (Node 22 and 24 on the lockfile Playwright, Node 22 on Playwright 1.52.0, Node 24 on the latest Playwright).
4. **Pre-flight checks** (read-only).
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

Expected: one heading line, and `"version": "<version>",`. If the heading is missing, the CHANGELOG was not committed before the bump: undo the bump (see [If something goes wrong](#if-something-goes-wrong)) and start again from step 2. Tags `v0.0.6`, `v0.1.1`, `v0.1.5` and `v0.1.6` were created this way; they stay as they are.

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

Expected: exit code 1 (one test fails on purpose), `Loupe report written to loupe-report`, and `loupe-report/` with `index.html`, `report.json` and `data/`. The report data in `index.html` has `schemaVersion` 1 and `generator.version` `<version>`. Remove `<tmp>` afterwards. The `.tgz` is ignored by git, but nothing needs to be packed into the repository.

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

## What a release never includes

- A `*.tgz` in git (ignored by `.gitignore`).
- A report (`loupe-report/`, `blob-report/`, `test-results/`, `playwright-report/`, `loupe-perf/`, all ignored).
- A change to `package.json` or `package-lock.json` made by Claude Code: only `npm version`, run by the maintainer, changes the version.
