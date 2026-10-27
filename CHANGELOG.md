# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0, minor versions may contain breaking changes. The JSON report has its own version (`schemaVersion`), see [`docs/schema/v1.md`](docs/schema/v1.md#versioning-policy).

## [Unreleased]

No change to the JSON shape: `schemaVersion` stays 1. The content of `stack`, `message` and the other strings changed: they no longer hold absolute paths.

### Changed

- **A report no longer reveals the machine that wrote it.** Reports up to 0.1.7 held absolute paths, with the home directory and the user name, in every stack trace, in error messages, and in the AI prompt copied from the test detail. Loupe now rewrites them in every string of the report: stacks, error messages, stdout and stderr, test and step titles, annotations and text attachment bodies.
  - A path under the Playwright root dir becomes relative to it (`cart.spec.ts:12:5`).
  - In stack frames and locations, a path sharing a directory with the root dir becomes `../` relative (`../support/session.ts`).
  - Any other home directory path becomes `~/…`; other paths are kept.

  Error signatures, categories and test ids are still computed from the original text: none changes. Category rules match the original text too, so a rule anchored on a relative path copied from the report (`^tests/`) does not match. Attachments (traces, screenshots, videos) are not altered. The rules and their limits (`merge-reports` blobs whose stacks never show their own test files, a root dir of one segment) are in [Paths in text](docs/schema/v1.md#paths-in-text).
- **`location.file` may start with `~/`**, for a location in a home directory that shares no directory with the root dir.
- **Common failure points read the frame paths of the report as they are.** Keys are unchanged, except for a function in a file sharing no directory with the root dir, which keeps its absolute path (`/opt/shared/x.ts#send`, before `../../opt/shared/x.ts#send`).
- **The stack in the AI prompt keeps its frame lines only.** Its first lines repeated the error message, printed just above. Lines after the first frame, such as a nested cause, are kept. The stack is left out when it has no frame, or when its only frame is the error location the prompt already gives. The test detail still shows the whole stack.

### Fixed

- **Error locations in merged reports point to the right file.** `merge-reports` does not rebase error locations, so with a merge config they pointed to the shard's file, relative to the merge root dir (`../../../runner/work/shop/shared/helper.ts` for a merge root dir `/home/alice/merge/tests`, instead of `../shared/helper.ts`), sometimes with that machine's user name. Loupe now finds the shard's root from the stacks.
- **On Windows, a location on another drive or a UNC share is `null`** instead of an absolute path, which the schema rejects. The stack still shows it.
- **The AI prompt lists each annotation once.** Since Playwright 1.52, each attempt's annotations start with a copy of the test's, and the prompt joined both lists: `bug: BUG-1; bug: BUG-1`. The test detail, the skip reason and annotation dimensions now merge the two lists the same way. Of these, only the test detail showed a duplicate: an annotation added twice at runtime was listed twice under "Annotations of this attempt". The JSON still holds both lists as Playwright gives them ([Annotation](docs/schema/v1.md#annotation)).

## [0.1.7] - 2026-10-26

No change to the JSON shape: `schemaVersion` stays 1.

### Added

- **The README shows each view of the report in light and dark, and links to a [live demo](https://qartisan.github.io/playwright-loupe/)**: the report of a small demo suite that fails on purpose, rebuilt at each release.

### Fixed

- **The sidebar no longer repeats a project's own test folder** under the project when projects have separate test directories: each project leaves out the folder shared by its own files, and its row names that folder for screen readers and in its tooltip.
- **Dimension widgets keep their accessible name when the dimension name has a space or a quote** (`Test type`): the widget's heading id is now a slug of the name, unique even when two names give the same slug, instead of the raw name. URLs are unchanged.

## [0.1.6] - 2026-10-25

No change to the JSON shape: `schemaVersion` stays 1.

### Added

- **Git information is now read from the local repository** when Playwright's metadata and the CI variables do not provide it. `git.local` / `LOUPE_GIT_LOCAL` turn off Loupe's own reads only. Loupe runs three read-only git commands once per run, for the commit hash, the branch and the `origin` URL (credentials removed), and never reads the commit message or the author. Under `merge-reports`, the local commit is not used, and the local branch and remote only when the local `HEAD` is the report's commit. To record no git information on a local run, also set Playwright's `captureGitInfo: { commit: false }`. See [Git information](docs/config.md#git-information).
- **"Skip to test list"**, the second element Tab reaches, after "Skip to content": it moves focus to the sidebar tree (the current test's row, or the row last focused), opening the sidebar first when it is closed. With no row to show, focus goes to the tree's "Tests" heading.
- **Landmarks are checked on every kind of page**: one banner, one main, the sidebar navigation named "Report", and every navigation (the sidebar, the pager of a test or an error group) named differently.
- **`#/run-details`** opens the Overview on its run details, with focus on their heading: the target of the partial run pill, and a link that can be shared.

### Changed

- **A partial run shows a pill in the header instead of a banner.** The full-width amber banner cut the header off from the sidebar and used the warning colour for a filter chosen on purpose. The pill sits after the run status, in a neutral style: "Partial: grep filter", "+2" when there are more reasons, "Partial" alone on narrow headers. It links to the run details, which list every reason and receive focus. Its text comes from the same labels as the run details, so the two never disagree.
- **The narrow sidebar is a drawer.** On windows 760 px wide or less, while the sidebar is open over the content, the content is dimmed and out of reach of the keyboard and assistive technologies; the header stays reachable. A click on the dimmed content closes the sidebar, and "Skip to content" closes it before moving focus to the content.

### Fixed

- **Escape closes the narrow sidebar.** It used to stay open. What is inside closes first: the first Escape clears the search text, closes a dialog or hides a tooltip, the next one closes the sidebar. Focus inside the sidebar returns to the sidebar button; elsewhere, it stays. Escape never collapses the sidebar on wide windows, and does not change the remembered sidebar choice.
- **The page no longer scrolls past the sidebar and the content.** Visually hidden text escaped the two scrolling panes and made the page taller than the window: the mouse wheel, at the end of a pane, scrolled the whole page into empty space, with a second scrollbar. Each pane now scrolls on its own and keeps the wheel, and the page never scrolls, except on short screens (400 % zoom), where it scrolls as a whole by design.

## [0.1.5] - 2026-10-23

### Changed

- **The report was checked with a screen reader**, Orca with Firefox: [Accessibility](README.md#accessibility) says what was checked and what was not.

### Fixed

- **Each copy is announced once, with its outcome.** With Orca and Firefox, a copy was announced three times, the button's "· Copied" read as if it said "not copied"; a repeated copy was not announced at all. The visible "· Copied" is now hidden from screen readers, and every message is read in full, repeated or not. When the browser refuses the copy, only the fallback dialog is announced.
- **The fallback copy dialog keeps acronyms in its title**: "Copy AI prompt", not "Copy ai prompt".

## [0.1.4] - 2026-10-23

Accessibility work on the report, towards WCAG 2.2 AA. See [Accessibility](README.md#accessibility) for what is checked and the known limits. No change to the JSON.

### Added

- **Skip link.** "Skip to content", the first element Tab reaches, moves focus to the report content.
- **Focus and page title follow the view.** Opening another view, test or error group from the content, with a shortcut, or with Back / Forward moves focus to its heading, so a screen reader announces it; the browser tab reads `<page> · <suite name>`. Filters, search, sort, "show more", attempts and dialogs never move focus.
- **The sidebar is browsed with the arrow keys and left with Tab.** The view links are one tab stop, like the test tree: Up / Down and Home / End move, Enter or Space opens. Opening a page from the sidebar keeps focus there and announces the page; the current view and the current test are marked as current for assistive technologies.
- **View shortcuts:** `o` Overview, `e` Errors, `h` Suite health, `t` Tests.
- **Single-key shortcuts can be turned off** (WCAG 2.1.4) with a switch in the keyboard shortcuts dialog, remembered in the browser; Escape and the arrow keys keep working.
- **Scroll keys work right after opening the report**, before anything has focus: Page Up / Page Down, Space, Home / End and the arrow keys.
- **Forced colours (Windows high contrast):** bars keep their colours; pressed buttons, the selected attempt, active chips, the current view and test, and focus rings use the system highlight colours.
- **Table captions** for screen readers on every data table.
- **Larger hit areas** (at least 24 × 24 px) for chips, small text buttons, sort buttons and text disclosures, with no visual change.
- For contributors: an axe-core accessibility test suite on every view, in the light and dark themes and under forced colours; axe-core is not in the report.

### Changed

- **`j` / `k` also walk error groups** on an error group page, in the order `n` / `p` used: one pair for next / previous everywhere.
- **The sidebar search stays above the test tree**, so the row focused with the arrow keys is never hidden under it.
- **At high zoom, the page scrolls as a whole** on short windows (480 px high or less): before, at 400 % zoom, the header could fill the window and hide the content.
- **Reduced motion:** when the system asks for it, transitions and smooth scrolling are turned off.
- On a test detail, the view links' tab stop is Tests (Errors on an error group page); a group revealed from a project card loses its highlight on the next page change.

### Removed

- **`[` / `]` (previous / next attempt):** on Belgian and French AZERTY keyboards they need AltGr, so they never worked on Windows or macOS. Attempt tabs remain keyboard operable: Tab to them, then the arrow keys.
- **`n` / `p` (next / previous error group):** replaced by `j` / `k`.

### Fixed

- **Single-key shortcuts work with Caps Lock on.**
- **Landmarks:** one `main` instead of two nested ones, and the header is exposed as a banner.
- **Error code snippets can be scrolled with the keyboard**, so long lines can be read without a mouse.
- **Focus no longer falls back to the top of the page** after opening a test from the Tests table.
- **Videos show a focus ring.**

## [0.1.3] - 2026-10-21

### Added

- **Common failure points.** A new Overview card, after the run errors and before the error categories, lists the functions of your code that appear in the stack of several failures, in different spec files and error groups: when one broken fixture or helper fails many tests with different messages, it shows the function they share. A lead, not a diagnosis. Each point gives its function, file and the lines seen, the functions folded under it ("via …"), its tests, files and error groups, the failed / flaky split and the categories involved, and opens the matching tests. Thresholds: 5 tests (a test in several projects counts once), 3 spec files, 2 error groups; 5 points at most. Spec files, anonymous functions, `node_modules`, Node and Playwright internals are left out; helpers outside the root dir are kept, with `../` paths. See [Common failure points](README.md#common-failure-points).
- **Failure point filter** in the Tests view and the sidebar, after the error category (`point` in the URL, `#` encoded as `%23`).
- **Error groups only seen after a test timeout are folded.** When the test timeout stops a test, the pending action fails too, as a second error of the attempt (`Request context disposed`, `Target page, context or browser has been closed`…). A group whose every error is such a secondary error (after `Test timeout of <n>ms exceeded.`, or the fixture and hook variants of the test timeout) now sits in a collapsed disclosure at the end of the Errors view's list and of each category, and group counts leave it out with a mention (`22 error groups · 18 more only seen after a test timeout`). Test counts and test categories are unchanged; `n` / `p` walk these groups last; their pages stay reachable, and the test detail labels the error "Raised after the test timeout". See [Groups only seen after a test timeout](README.md#groups-only-seen-after-a-test-timeout).
- **Why a test was skipped.** The reason given in the test code (`test.skip(condition, 'reason')`, `test.fixme(…)`, `testInfo.skip(…)`, in a test, a `describe` or a hook) now shows as `Skipped: <reason>` or `Fixme: <reason>` in Suite health, on a muted line under the title in the Tests view (one line, the full text in the tooltip and the accessible name), and next to the outcome in the test detail header. Without a reason: `Skipped (no reason given)` / `Fixme (no reason given)`. A test Playwright skipped without any skip annotation (a failed dependency project or earlier test of a serial group, `--max-failures`, a stopped run) shows `Not run`, with a sentence listing these usual causes, never asserting one. The search (`q`) also matches the reason's text. Read from the existing annotations: no change to the JSON. See [Skip reasons](README.md#skip-reasons).
- `npm run perf:sample` writes a third dataset, `cascade`, with realistic stacks through invented helpers (some outside the test dir) and 50 spec files, and also times the opening of the Overview.

### Changed

- **Error signatures of `toBeOK()` keep the response status.** For `expect(response).toBeOK()` (and `not.toBeOK()`), the status is only in Playwright's call log, which signatures cut: a 429, a 404 and a 503 shared one error group, shown under the category of its first error. The signature now keeps the final response line of the call log (`← 503 Service Unavailable`, the last one after redirects), so each status gets its own group, matching its category. The same status on different endpoints still shares one group. Other messages keep their signature; `toBeOK()` failures get a new one, so their groups do not match those of earlier reports. No change to the JSON shape (`schemaVersion` stays 1). See [Error signature](docs/schema/v1.md#error-signature).
- Suite health's skipped tests use the new wording (`Skipped: <reason>`, `Fixme (no reason given)`, `Not run`) instead of a `fixme` badge and "No reason given"; a test with several skip annotations shows the first one with a reason.

## [0.1.2] - 2026-10-21

### Security

- **Secrets are redacted from the report.** Reports are shared (CI artifacts, links), but they could contain secrets in clear: the value typed by `fill` into a password field is part of Playwright's step title (`Fill "<value>"`), and the call log of a failing API call prints the request and response headers, session cookies and bearer tokens included. Loupe now replaces them with `[redacted]` in `report.json`, and therefore in `index.html`, before writing them and before computing error signatures and categories. No change to your tests.
  - **Input steps** (on by default): the value of `fill`, `type`, `pressSequentially`, `keyboard.type` and `keyboard.insertText` steps whose target has a secret-looking name, read from the step subtitle (Playwright 1.63+) or, on every version, from the source line of the call. That fallback also covers `keyboard.*` and neutral locators when the code names the value (`fill(password)`). The same value is redacted where Playwright repeats it in that attempt's errors (`fill("[redacted]")` in call logs, assertion lines).
  - **HTTP headers** (on by default): `cookie`, `set-cookie`, `authorization`, `proxy-authorization` and any header with a secret-looking name, in call logs (`- cookie: [redacted]`).
  - **URL parameters** (on by default): query and fragment parameters with a secret-looking name, wherever URLs appear (navigation steps, call logs, error messages, stdout), keeping the name: `?token=[redacted]`, `#access_token=[redacted]`.
  - **Environment values** (opt-in): the values of the variables listed in the new `redact.env` option, or added through `LOUPE_REDACT_ENV`, everywhere in the report. Values shorter than 6 characters and unset variables are skipped with a warning naming the variable.
  - New `redact` option (`patterns`, `mode`, `env`), validated at startup; one list of secret-looking names for input steps, headers and URL parameters, with whole-word matching (`auth` matches `x-auth-token`, not `Author`). The environment can add names, never remove them.
  - **Not redacted**: attachments (traces, screenshots and videos contain typed values: treat a report with traces as private), snippets (source code from your repository), attachment file names. See [Secret redaction](docs/config.md#secret-redaction). Reports written by earlier versions are not rewritten.

### Changed

- **Error signatures keep HTTP status codes.** A status code (100–599) in an HTTP context is no longer replaced with `<n>`, so `Unable to delete the member with API with error 401` and `… with error 500` are two error groups instead of one. Other numbers are normalized as before. This changes how signatures are computed, not the JSON shape (`schemaVersion` stays 1): signatures of messages with an HTTP status change, so groups do not match across this upgrade for those errors. See [Error signature](docs/schema/v1.md#error-signature).
- **Wider HTTP context, shared by categories and signatures.** A status code now also counts as an HTTP status after `error` (`with error 503`, `Error: 503`) and before its standard reason phrase (`401 Unauthorized`, previously only for 5xx). Categories change accordingly: an error such as `… with error 503` is now **Server error** and `… error 429` **Rate limited**, where they could be Uncategorized (or Assertion, Timeout) before. See [HTTP context](docs/schema/v1.md#http-context).

### Fixed

- Docs: `Step.subtitle` is provided from Playwright **1.63**, not 1.61, and before that the target of an action is not always in the title: Playwright 1.53 to 1.62 leave it out (`Click`, `Fill "<value>"`). Only 1.52 writes it there (`locator.getByRole('button').click`). The report itself is unchanged.

## [0.1.1] - 2026-10-18

### Added

- **Tags and dimension values in the Tests view.** Each row shows, under the test title, what the test covers as small neutral chips: its dimension values first (dimensions in config order, annotation-based ones included, then values in the test's order; the chip shows the value, `api`, and its tooltip and accessible name the dimension, "Layer: api"), then its free tags with their `@`, sorted. As in the filters, a tag a dimension takes appears only as that dimension's value. Each chip is a link that adds its value to the filters, keeping the others and the sort; a chip whose value is already filtered is shown active (inverted, with a ×) and removes it ("Remove filter Layer: api"). Both add a history entry, so Back undoes them. A row shows up to four chips, then a "+N" button (`aria-expanded`) that shows the rest in place; that state is not in the URL. Active chips are never hidden behind "+N": they are always shown, the other slots filled in the normal order, and "+N" counts only the chips actually hidden. The chips of each test are computed once per report. No chip line for a test without tags or dimensions. Other annotations stay in the test detail.
- `npm run perf:sample`: writes 5,000-test reports from the renderer sample (`loupe-perf/`, gitignored) and, with `-- --measure`, times the Tests view (opening, filtering, sorting, searching) in Chromium, optionally against another renderer build (`--renderer`), so performance measurements are reproducible.

### Changed

- **Search covers tags and dimension values.** The search (`q`, in the sidebar) now also matches every raw tag of a test, those a dimension takes included (`smoke`, `@smoke` and `layer:api` all match), and its dimension values, annotation-based ones included (`BUG-42`). Same rules as before: case- and accent-insensitive, every word must match, as substrings.
- **Trace command: absolute path over `file://`.** When the report is opened from disk, "Copy trace command" copies the absolute path of the trace, computed from the report's own location (`npx playwright show-trace '/home/me/app/loupe-report/data/…/trace.zip'`), so the command works from any directory. Its help now says to run it from your project root, so it uses the project's own Playwright: the same rule as the rerun commands. The path is decoded (spaces, accented characters) before POSIX quoting; a Windows drive path loses the leading `/` of its URL form (commands stay POSIX-only). Over `http(s)` and for a `file://` URL with a host (a network share), the disk path is unknown: the command keeps the path relative to the report folder and the former help. The "Download trace" link is unchanged.

## [0.1.0] - 2026-10-18

### Added

- **Screenshot thumbnails and viewer.** In the test detail, each attempt's screenshots are a grid of thumbnails (lazy-loaded, the attachment name under each). A click, or Enter / Space, opens a viewer in a modal dialog: the image fitted to the window, or at actual size (scrollable) by clicking it or with "Actual size"; previous / next with buttons or `←` / `→`, with the position ("2 of 3") and no wrap-around; "Open original" in a new tab. Escape, the close button or a click outside closes it and puts focus back on the thumbnail. Page shortcuts are inactive while it is open, and any route change (Back, another test) closes it; its state is never in the URL. A missing file shows its name and path, never a broken image.
- **Screenshot comparison.** The `expected`, `actual` and `diff` images of a `toHaveScreenshot` / `toMatchSnapshot` (same `comparison.group`, same attempt) form one card, shown before the other screenshots, with four modes: Diff, Side by side (expected | actual, both at the same scale), Slider (actual over expected with a divider) and Overlay (actual over expected with an opacity control). Only the modes the available images allow are offered, and a group with a single image is a normal screenshot. The default is Diff when there is a diff image, otherwise Side by side; the chosen mode is shared by every comparison for the session, in memory only. Slider and overlay are `<input type="range">` controls, operable with the keyboard. Each image's natural size is shown, with "Expected and actual sizes differ" when they do: slider and overlay then align the images top-left in a box the size of the larger one. "Open in viewer" opens the comparison, with the same modes, in the screenshot viewer, where it comes before the screenshots.
- **Inline videos**: `<video controls preload="metadata">` with the attachment's content type, and "Open original". A missing or unplayable file shows its path instead of an empty player.
- **Trace command.** Each trace attachment has a card with "Copy trace command" (`npx playwright show-trace <path>`, the path quoted for a POSIX shell when needed; copied with the same fallback dialog and announcement as the rerun commands) and "Download trace". Its help says to run it from the report folder (the one containing `index.html`) and that it uses the project's own Playwright, which must be at least the run's version (`run.playwrightVersion`), since an older trace viewer shows an empty screen on a newer trace; that sentence is left out when the report has no version. The report does not serve the trace viewer itself: it needs an HTTP server.
- `←` / `→` in the keyboard shortcuts dialog and the README.
- **Run details** on the Overview, after the projects, in three groups shown side by side when there is room and stacked on narrow screens, each a description list under its heading: **Run** (scope, "Full run" or "Partial run" with its reasons; CI, the provider or Yes / No; workers; shard, "2 of 4"), **Code** (commit, short with the full hash in the tooltip and a copy button; branch; repository) and **Environment** (Playwright, Loupe, Node, OS). Empty values are left out, and a group without any value is not shown. Plain text, no links to commits or repositories.

### Changed

- **Header layout.** Two columns: the run on the left, the controls (keyboard shortcuts, theme switch) always top-right on the first row, at every width. The left column has three groups that wrap as units, always in this order: identity and verdict, status counts, start date and duration with the environment. The suite name is truncated with an ellipsis, the full name in its tooltip; on very narrow screens the verdict goes under the name. No horizontal page scroll down to 320 px.
- **Branch and commit moved from the header to the Run details card.** The header keeps the start date, duration and environment. A commit is shown with 7 characters, the full hash in the tooltip and the copy button.

### Fixed

- Dialogs: reopening one right after closing it with Escape could leave it closed, because the dialog's close event arrives after the reopening.

### Security

- **Credentials in `git.remote`.** Versions up to 0.0.6 could store part of a password or a token in `run.git.remote`: a password containing `@` kept what followed the first `@` (`https://user:p@ss@host/…` became `https://ss@host/…`), a password containing a raw `/` was kept whole, and query strings (`?access_token=…`) and fragments were never removed. The remote is now parsed like browsers and git do (the last `@` ends the credentials), the user name, password, query and fragment are removed, and a remote with an `@` that cannot be parsed safely is stored as `null`. Without a scheme, only the `user@host:path` form with a user name without `:` (`git@github.com:org/repo.git`) and strings without `@` are kept. Reports written by earlier versions are not rewritten: check `git.remote` in reports you have shared if your CI remote can contain credentials.

## [0.0.6] - 2026-10-18

### Added

- **Test detail** (`#/test/<id>`): title path, outcome, project, `file:line`, total duration, error category, tags, annotations and dimensions; then one tab per attempt ("Attempt 1", "Retry 1" …, each with its status and duration), hidden for a single attempt. The default attempt is the last failing one: a failed test opens on its last attempt, a flaky test on its failure, not on the passing retry. The attempt is in the URL (`?attempt=1`) next to the filters; an index the test does not have falls back to the default attempt and the URL is corrected. Per attempt:
  - **Errors**, each with its category, `file:line:column`, a "View error group" link with the group's test count, the code snippet and the stack (collapsed). Playwright's colors are rebuilt from the text: the value of `Expected:` / `Received:` lines (and `Expected substring:`, `Received string:`, `Expected pattern:`, `Received array:` …), the `-` / `+` lines of a diff opened by the `- Expected` / `+ Received` header (only there: call log lines are never colored), and the snippet's arrow and caret. The report keeps messages without ANSI codes, so Playwright's character-level highlighting inside strings is not reproduced. Messages are rendered as text, never as HTML. Two new color tokens, `--diff-expected` and `--diff-received`, meet WCAG contrast in both themes.
  - **Steps**: `test.step` steps and steps with an error, with the ancestors needed to place them; each step with children expands. The failing path is highlighted and expanded on load. "Show all steps" (`?steps=all`) adds hooks, fixtures, API calls and `expect` steps, each with its category. A step's error message is shown under the step it comes from.
  - **Attachments**, listed by kind (screenshots, videos, traces, text, other) with their content type: files as relative links (they work from `file://`), small text bodies inline and collapsed, with their size. Viewers come in a later release.
  - **stdout and stderr**, collapsed, with a notice when the report truncated them.
- **Rerun commands**, copied to the clipboard, to paste in a POSIX shell (bash, zsh; not `cmd.exe`) from the Playwright root directory:
  - this test only, in its project (`npx playwright test basics.spec.ts:34 --project=chromium-a`; no `--project` for an unnamed project);
  - the failed tests of its file, shown only when another line of the file failed (the same test failing in another project does not count), labeled with the distinct `file:line` per project and the projects involved (`10 failed tests in this file, in chromium-a, chromium-b`);
  - the failed tests of the current list, every one of them, not only the rows shown: above the Tests view's table, and as "Rerun failed tests" under the overview's verdict.

  Projects with exactly the same `file:line` arguments share one command (`--project=a --project=b`); when the sets differ, each project gets its own command, joined with `&&`, because one command would run every file in every project. Arguments are sorted by file, then line, and each `file:line` is given once. Arguments with spaces or shell characters are single-quoted, an inner `'` written `'\''`. Flaky tests are left out. A `file:line` targets the line where the test is declared, and reruns every test declared there: a command is only valid while the file has not changed since the run. Above 100 tests, a note says the command is long.
- **AI prompt**, copied to the clipboard only, in English: an instruction (most likely cause, test or application, a fix), the test, the attempt, tags and annotations, each error with its message, snippet, location and stack, the failing step with up to 5 steps before it, and the names of the attachments. New option `aiPrompt.includeStack` (default `true`) leaves the stacks out; it is a renderer setting, not part of `report.json`.
- **Copy fallback**: when the browser refuses the Clipboard API (some do on `file://`), a dialog shows the text selected, to copy by hand. Successful copies are announced to screen readers.
- **Previous / next**: on the test detail, through the Tests view's current list (filters and sort, every row, not only the first 500), each test on its default attempt; on an error group page, through the Errors view's order. A group opened from a category (its section in the Errors view, `#/errors/category/<name>`) carries `category=<name>` in its URL and walks that category's groups only; a group opened from the global list or from a test walks every group. No wrap-around at the ends.
- **Keyboard shortcuts**: `j` / `k` next and previous test, `[` / `]` previous and next attempt, `n` / `p` next and previous error group, `?` the list of shortcuts (also behind a keyboard icon in the header). They never fire while typing in a field, with Ctrl, Alt or Meta held, or while a dialog is open. Documented in the README.
- **Fixture suite**: two intentional failures, a `test.step` failing at the second level (`fails inside a nested step`) and a `toEqual` with a multi-line diff (`returns a different order`). The fixture snapshot gains these 4 tests (2 per project); tests declared after them moved down a few lines.

### Changed

- **Tests view default sort**: declaration order, exactly like the sidebar: project (report order), file, line. It used to be status severity, then title path. Filters are there to focus on failures; the default order is now the same in the sidebar, the table and the test detail's previous / next. It is not written in the URL (no `sort` parameter). The Status header still sorts by severity (failed, flaky, passed, skipped), with project, file, line as tie-breaks; other columns still break ties by title. A link with `sort=status:asc` keeps the former order.
- **Error groups inside a category** are listed in the Errors view's order (most failed tests first, then most flaky), the order their previous / next buttons follow, instead of first occurrence.
- **Renderer dev sample**: `npm run sample:update` also copies the sample's attachment files to `src/renderer/dev/data/` (gitignored), and the dev server serves them at `data/`, so attachment links work there too.

## [0.0.5] - 2026-10-17

### Added

- **Attempts on error group rows.** When an affected test ran more than once, a group row says how many of the attempts failed with that error: `failed on 2 of 2 attempts` (same failure on the retry), `failed on 1 of 2 attempts` (the retry passed or failed differently; the test then also appears in the other group). For several tests the counts add up (`failed on 5 of 7 attempts`). Nothing is added when every test ran once.

### Changed

- **Error signatures: UUIDs glued to a prefix are now recognized.** A UUID used to be replaced only between word boundaries, and `_` is a word character, so in `evt_3f2b8c1e-…` it was not replaced and a test and its retry could get two signatures for the same failure. A UUID is now replaced when it does not touch a hex digit, directly or through a hyphen: `evt_<uuid>`, `req-<uuid>`, `id=<uuid>` and a bare UUID are replaced; a UUID-like part of a longer hex run (`abc-<uuid>`, and `id<uuid>`, since `d` is a hex digit) is not. Messages with such UUIDs get a new signature, so their groups differ from 0.0.4; other signatures are unchanged (none of the fixture suite's). The JSON shape is unchanged: `schemaVersion` stays `1`. See [Error signature](docs/schema/v1.md#error-signature).
- **No repeated category badge inside a category.** In the Errors view, the error groups listed under a category (also on `#/errors/category/<name>`) no longer repeat its badge; lists that mix categories keep it.

## [0.0.4] - 2026-10-17

### Added

- **Filters, synced with the URL.** One filter state for the whole report, in the hash fragment, so a filtered view can be shared, bookmarked or reloaded, from `file://` too: `#/tests?q=login&status=failed,flaky&project=chromium&tag=@smoke&dim.Layer=api&category=Network&sort=duration:desc`. Values of a filter are combined with OR, filters with AND; the search matches every word, ignoring case and accents, in the title path, file and project. Unknown parameters or values are dropped and the URL rewritten in a single canonical form. Clicked filters add a history entry, so Back undoes them; typing in the search does not. The overview, errors and suite health views stay summaries of the whole run; the sidebar follows the filters. The error category filter uses every category of a test's failing attempts, the same definition as the dashboard counts.
- **Tests view** (`#/tests`), a new sidebar entry: every test in one flat list (status, title path, project, file, duration, error categories, attempts), sortable by column (failed, flaky, passed, skipped by default). A filter bar with one menu per facet (status, error category, project, tag, then each dimension in config order; the URL parameter of the error category is `category`), each value with the number of tests it would give; active filters as removable chips, "Clear all", an empty state with a reset button, and a result count announced to screen readers. The error category column shows the test's category (first error of its last failing attempt) and `+N` when its failing attempts had others, listed in the tooltip and the accessible name. The list renders its first 500 rows after filtering and sorting (`Showing 500 of 4,200 tests`), with "Show 500 more" and "Show all"; any filter or sort change starts again from 500, which keeps interactions fast on runs of several thousand tests. Projects without a name cannot be filtered: an empty name cannot be written in the URL. A tag a dimension is built from (`@layer:ui` with a `layer` dimension, configured or automatic) is filtered through that dimension only, not in the tag facet, which is hidden when no tag is left; such a `tag=` value is dropped from the URL. The JSON keeps every raw tag.
- **Search in the sidebar**, always visible: `/` focuses it, Escape clears it. When filters are active, a line shows how many and how many tests match, with a link to the Tests view and "Clear". The tree is reduced to the matching tests and opens fully when they are few.
- **Links to filtered tests.** Header counts (`20 failed` → `#/tests?status=failed`, replacing the current filters), overview error categories (`#/tests?category=…`, the uncategorized bucket included; they used to open the category in the Errors view, which `#/errors/category/<name>` still does) and suite health dimension values in bars, tiles and tables (`#/tests?dim.<name>=<value>`).
- **Run start in the header**, in the viewer's time zone with the zone written out, then the duration (`16 Oct 2026, 14:58 CEST · 5.9 s`). Hover or keyboard focus shows the full date with seconds, the IANA time zone and the UTC timestamp. Hidden when `startedAt` is missing or invalid.

### Changed

- **Sidebar grouped by folder:** projects → folders → files → `describe` blocks → tests. The directory prefix shared by every file (`tests/e2e/`) is left out of the tree and shown once above it; a folder with a single subfolder is shown on one line (`api/users`). Long file names are cut in the middle, keeping their start and extension; the full path is in the tooltip and the accessible name.

## [0.0.3] - 2026-10-16

### Added

- **HTML report application shell.** The renderer is rebuilt with Preact and `@preact/signals`, still one self-contained `index.html` that works from `file://` (both libraries are bundled into it: the package keeps zero runtime dependencies).
  - Header with the run summary: status, counts per outcome, duration, branch, commit and environment. A partial run shows a banner with the reasons it was detected.
  - Collapsible sidebar with a test tree: projects → files → describe blocks → tests, single-child levels merged, a status icon per test (passed, failed, flaky, skipped) and failure counts per node. Keyboard navigation (arrows, Home / End, Enter), the current test highlighted and revealed. Collapsed nodes are not rendered, so large suites stay responsive.
  - Hash routes that work from `file://`: `#/` (overview), `#/errors`, `#/health`, `#/group/<signature>`, `#/test/<id>`. The URL is the single source of navigation state.
  - Light and dark themes: the system theme by default, or the `theme` option; the viewer's choice is remembered in the browser when storage is available.
  - The test page is a placeholder for now.
- **Dashboard, in three views** reached from fixed sidebar entries. Widgets with nothing to show are hidden, except the verdict.
  - **Overview** (`#/`): the verdict (failed, flaky or passed, a stacked bar of the outcomes with their counts, pass rate and duration; a run with run errors is never green), run errors when there are any, compact error categories (one bar per category, each opening that category in the Errors view, `#/errors/category/<name>`), and project cards (counts, pass rate, test time; a click reveals the project in the sidebar).
  - **Pass rate**, one definition everywhere: passed / (total − skipped), labeled "pass rate", with a tooltip saying skipped tests are excluded.
  - **Errors** (`#/errors`): run errors, every error group (most failed tests first, then most flaky), and the categories in detail, each expanding to its groups. Error groups are listed here only. The sidebar entry shows a warning marker and the count when the run has run errors. The former `#/run-errors` route redirects here.
  - **Suite health** (`#/health`): one widget per dimension. Up to 8 values, one stacked bar per value (passed / failed / flaky / skipped) with the total; more values, a grid of tiles colored by worst status with its icon, problem values first, details on hover and keyboard focus, and a summary line (`38 values · 36 all passed · 2 with failures`). The exact table expands from every dimension widget. Tag hygiene: values outside the declared ones and values differing only by case (`API` / `api`) are flagged, never merged; a hint points to `values` when a dimension declares none. Then the ten slowest tests, the flaky tests with the error of their failing attempt, and the skipped tests with their reason.
  - An error group row shows its category, its failed / flaky split, the first affected test (`+N others`) and the line that tells the error apart: the `Locator:` line or the HTTP response status rather than a generic `expect(locator).toBeVisible() failed`.
- **Error group pages** (`#/group/<signature>`): category, signature, failed / flaky split, a full sample message and every affected test with the attempts where the error occurred. Groups are computed in the renderer from the existing report data.
- **Visual identity.** New light and dark palettes, "Loupe" wordmark in the header, a "Loupe — a reporter for Playwright" footer with the version, and DM Sans (regular and semibold, latin) embedded in the HTML so the report keeps working offline. The font is under the SIL Open Font License, shipped in `licenses/DM-Sans-OFL.txt`. Contrast (4.5:1 for text, 3:1 for borders and icons) is checked by the test suite in both themes. The HTML report is about 52 kB gzip, 29 kB of which are the fonts.
- **Category colors from a palette.** `categories.rules[].color` now also accepts a palette name: `blue`, `cyan`, `teal`, `violet`, `magenta`, `orange`, `brown`, `gold` (see [Category palette](docs/config.md#category-palette)). An unknown name is a config error listing the valid names. `#rrggbb` colors still work; the HTML report derives light and dark shades from them that meet the contrast rules.

### Changed

- **Error signatures change again: failures are grouped differently from 0.0.2.** The signature now uses only the stable part of Playwright messages. A strict mode violation loses its element list and count (`resolved to <n> elements`), so a test and its retry get the same signature when the page gained an item between attempts (`.first()` vs `.nth(1)`, `li:nth-child(13)` vs `14`). A locator assertion keeps only its `Error:` lines, `Locator:`, and `Expected…:` / `Received…:` lines: the timeout and screenshot pixel counts no longer count. Different locators, actions or expected values still give different signatures. The call log, stack and code frame were already left out. The JSON shape is unchanged: `schemaVersion` stays `1`. See [Error signature](docs/schema/v1.md#error-signature).
- **Built-in category colors changed** to the new palette, without reds or greens and with no two alike (they were near-duplicate indigos, and Assertion was red like a failure): Ambiguous locator violet `#8656b7`, Locator not found magenta `#ad4681`, Rate limited teal `#04837c`, Server error orange `#ab5803`, Network cyan `#0a7da1`, Assertion blue `#466cc8`, Timeout brown `#745f43`, Uncategorized `#6b6b6b`. New values, same shape: `schemaVersion` stays `1`. `CategoryDefinition.color` is now documented as a reference color that renderers may adapt per theme.
- **Categories without a configured color** take, in config rule order, the first palette color no other category of the report uses (gold, never used by a built-in category, comes last). Colors used to be assigned over every rule, so with the built-in categories present a configured category could share a color with one shown next to it. The same config with the same categories present always gives the same colors; set `color` for a color that never changes.
- **New built-in error category: Ambiguous locator**, evaluated first, before "Locator not found". It matches Playwright's `strict mode violation` (a locator resolving to several elements), which was "Uncategorized" or "Assertion" before. See [Error categories](docs/schema/v1.md#error-categories).

### Fixed

- **Run scope with `--no-deps`.** Playwright keeps `project.dependencies` in the config reporters get, so with `--project x --no-deps` the dependencies of `x` counted as running and the run could be reported `full` while a configured project was left out. They no longer count: the run is `partial` with the `project-filter` reason.
- **Run scope with `default: false` projects** (Playwright 1.64+). The reference for a full run is now the set of default projects: a plain run is `full` even though the non-default projects did not run, and `--project nightly` alone is `partial` because the default projects are missing. See [Default projects](docs/schema/v1.md#default-projects).
- **Run scope with several `--project` values.** `--project a b` selects two projects, as in Playwright; `b` was taken for a file filter and the run reported a `file-filter` reason.

## [0.0.2] - 2026-10-15

### Changed

- **Error signatures change: failures are grouped differently from 0.0.1.** Normalization now also replaces e-mail addresses with `<email>` and cuid-like and nanoid-like identifiers (20+ characters mixing letters and digits) with `<id>`, so the same failure for different users or records gets one signature. A signature computed by 0.0.1 for a message containing such values no longer matches. The JSON shape is unchanged: `schemaVersion` stays `1`. See [Error signature](docs/schema/v1.md#error-signature).
- **New built-in error categories**, evaluated after "Locator not found" and before "Network", "Assertion" and "Timeout": **Rate limited** (`Too Many Requests`, `rate limit`, a 429 in an HTTP context such as `status 429`, `HTTP 429` or `Response status: 429`) and **Server error** (a 500–599 status in the same contexts, or with its reason phrase such as `502 Bad Gateway`). Errors from `failOnStatusCode` and failed `expect(response).toBeOK()` that were "Uncategorized" or "Assertion" now land in these categories. A bare number (`429ms`, `Received: 500`) does not match. See [Error categories](docs/schema/v1.md#error-categories).
- The package description now lists only what exists today.

## [0.0.1] - 2026-10-13

First public release. Work in progress: the reporter and its JSON model are usable, the HTML renderer is a minimal skeleton.

### Added

- **Playwright reporter** (`@qartisan/playwright-loupe`) that writes `report.json`, a self-contained `index.html` with the report injected, and the attachments under `data/`. Works with `playwright test` and `playwright merge-reports`, including sharded runs merged from blob reports.
- **JSON report model, schema v1** (`schemaVersion: 1`), documented in [`docs/schema/v1.md`](docs/schema/v1.md) with a JSON Schema and exported TypeScript types (`import type { LoupeReport } from '@qartisan/playwright-loupe'`):
  - stable test ids (project + file + title path), identical across sharded, merged and unsharded runs;
  - run metadata: status, duration, Playwright version, git commit and branch, CI detection (GitHub Actions, GitLab, Azure Pipelines, CircleCI, Jenkins, Bitbucket, Buildkite, Travis), environment name, shard, workers;
  - run scope (`full` | `partial`) with the reasons it was detected (file filter, grep, project filter, last-failed, `--only-changed`, `test.only`, `LOUPE_RUN_SCOPE`, and others);
  - every attempt of every test (retries included), each with its errors, steps, annotations, stdout/stderr and attachments; screenshot comparisons are linked as expected / actual / diff;
  - normalized error signatures that group the same failure across tests and runs (ANSI codes, call log, UUIDs, URLs, dates, paths, durations, hex strings and numbers removed or replaced);
  - fields reserved for phase 2: `run.excluded` (always `null` in v1) and `notes` (always empty in v1).
- **Run errors** (`run.errors`): errors reported outside any test (a spec file that fails to load, a failing global setup or teardown, a worker fixture failing in teardown), with location, signature and category. A run with zero tests still produces a valid report. Run errors survive `merge-reports`; the `(<tags>) ` prefix `merge-reports` adds for a shard config with a `tag` is ignored by signatures and category rules.
- **Configuration**: `loupe.config.ts` (or `.mts`, `.js`, `.mjs`) next to `playwright.config.ts`, typed with `defineConfig()`, loaded through Playwright's own TypeScript transform. Options can also be passed inline in the reporter entry and through `LOUPE_*` environment variables (precedence: defaults < config file < inline options < environment variables). The config is validated at startup: an invalid option or an unknown key stops the run with an explicit message. See [`docs/config.md`](docs/config.md).
- **Error categories**: ordered regex rules matched on the message, stack or failing step titles; built-in rules (locator not found, network, assertion, timeout); `extend` or `replace` mode; a visible uncategorized bucket.
- **Dimensions**: automatic dimensions from prefixed tags (`@layer:api`), and configured dimensions from tags or annotations (`{ type: 'bug', description: 'BUG-1' }`), with optional expected values.
- **Minimal HTML renderer**: a self-contained page with the run summary (status, counts, duration, scope, environment, commit) and the tests grouped by project and suite. Renderer settings: `title`, `theme`, `screenshots.defaultView`. The full dashboard and test details come in later releases.

### Compatibility

- Node.js **22.12 or later** (`engines.node`), needed to load ES module config files. CI tests the latest Node.js 22.x and 24.x.
- `@playwright/test` **1.52 or later** (peer dependency). CI tests 1.52 (on Node.js 22) and the latest version. Playwright 1.52 hangs on recent Node.js 24 releases, independently of Loupe: see [Compatibility](README.md#compatibility).

[Unreleased]: https://github.com/qartisan/playwright-loupe/compare/v0.1.7...HEAD
[0.1.7]: https://github.com/qartisan/playwright-loupe/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/qartisan/playwright-loupe/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/qartisan/playwright-loupe/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/qartisan/playwright-loupe/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/qartisan/playwright-loupe/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/qartisan/playwright-loupe/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/qartisan/playwright-loupe/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/qartisan/playwright-loupe/compare/v0.0.6...v0.1.0
[0.0.6]: https://github.com/qartisan/playwright-loupe/compare/v0.0.5...v0.0.6
[0.0.5]: https://github.com/qartisan/playwright-loupe/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/qartisan/playwright-loupe/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/qartisan/playwright-loupe/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/qartisan/playwright-loupe/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/qartisan/playwright-loupe/releases/tag/v0.0.1
