# Demo suite

This Playwright suite feeds the Loupe live demo report. It tests **Demo Store**, a small invented shop in `app/`, and **fails on purpose** so the report has something to show. **Never "fix" its failures.**

Run it from the repository root with `npm run demo`: it builds Loupe, runs the suite and checks the result (`scripts/run-demo.mjs`). The report lands in `demo-report/`. Add `-- --open` to open it in your browser.

The live demo is built in CI only. Loupe writes paths relative to the root dir and masks home directories, so a report holds no machine path; `run-demo.mjs` fails, in CI too, when `report.json` or `index.html` holds a home directory path (`scripts/home-paths.mjs`).

## Layout

- `app/`: Demo Store. `server.mjs` is a dependency-free Node server on `127.0.0.1:3917`, started by Playwright's `webServer`; `public/` holds its pages. No external network.
- `tests/web/`: the `web` project, in Chromium.
- `tests/api/`: the `api` project, without a browser (the `request` fixture only).
- `support/session.ts`: `signIn`, shared by both projects.
- `playwright.config.ts`, `loupe.config.ts`: the configs, as a user would write them. Inside this repository, the reporter entry points at `../dist/index.js` and `loupe.config.ts` imports its type from `../src/`; a user writes `@qartisan/playwright-loupe` in both places.

## What each intentional outcome illustrates

| Test | Outcome | Illustrates |
| --- | --- | --- |
| Catalog › shows prices with the currency symbol first | failed | **Assertion**, with a `bug` annotation (`DEMO-142`): the shop prints `14.00 €`, the test expects `€14.00`. |
| Catalog › keeps the product card design | failed | **Visual regression** (a category from `loupe.config.ts`): the screenshot comparison with expected, actual and diff images. The committed baseline is the card's previous design (green button, square corners). |
| Cart › with a product › removes a product | failed | **Ambiguous locator**: the "Saved for later" section has a second "Remove" button. Trace attached. |
| Cart › with a product › adds shipping to the total | failed | **Assertion** inside a nested `test.step`, with a `bug` annotation (`DEMO-151`): the total leaves out shipping. Trace attached. |
| Checkout › card payment › pays by card | failed | **Payment provider** (a category from `loupe.config.ts`, which wins over the built-in "Assertion"): the provider is unavailable. Steps and a video. |
| Account › orders › downloads an invoice | failed | **Locator not found**: the link was renamed "Invoice (PDF)". |
| Account › orders › exports the order history | failed | **Timeout**: the export button is never enabled, so the click runs until the test timeout. Its second error ("raised after the test timeout") is folded on the Errors view. |
| Products API › returns the stock of a product<br>Cart API › reserves stock for the cart items<br>Order lifecycle › checks stock before shipping | failed | **Server error**, one error group shared by three tests in three files: the inventory service answers 500. |
| Products API › recommends related products | failed | **Rate limited**: a 429. |
| Products API › still answers on the legacy search endpoint | failed | **Network**: a refused connection. |
| Catalog › shows recently viewed products to a returning customer<br>Account › orders › lists the orders of a returning customer<br>Account › opens the staff dashboard<br>Orders API › lists the orders of a returning customer<br>Orders API › lets staff see every order | failed | The **common failure point**: five tests in three files, in both projects, fail inside `signIn` (`support/session.ts`) with two messages ("Password expired", "Two-factor code required"), so two error groups. No rule matches them: they show the **Uncategorized** bucket. |
| Cart › shows the delivery estimate<br>Cart API › estimates the delivery date | flaky | The delivery service answers 503 to each client's first request (a cold start), so the first attempt fails and the retry passes. The client is the test (`x-client-id: <testId>`), and the server lives for the whole run: deterministic. |
| Catalog › product page › shows customer reviews<br>Cart › with a product › applies two discount codes at once | skipped | **Fixme** with a reason. |
| Checkout › pays with a wallet | skipped | **Skipped** with a reason: it needs `WALLET_SANDBOX_URL`, which is never set. |
| Order lifecycle › ships the order<br>Order lifecycle › sends the delivery notification | skipped | **Not run**: a serial group whose second test fails, so Playwright skips the rest without an annotation. |

All the other tests pass.

## Dimensions

- Tags: `@area:catalog`, `@area:cart`, `@area:checkout`, `@area:account` (an `Area` dimension with declared values), `@layer:ui` and `@layer:api` (an automatic `layer` dimension), and the unprefixed `@smoke`.
- Annotations: `owner` (an `Owner` dimension with declared values, set on each `describe`) and `bug` (a `Bug` dimension).

## Attachments

Kept small for the live demo (target under 5 MB for the whole report, ceiling 10 MB checked by `run-demo.mjs`):

- a screenshot on every failure (`screenshot: 'only-on-failure'`);
- videos for `tests/web/checkout.spec.ts` only, traces for `tests/web/cart.spec.ts` only (`test.use` at file level, kept on failure);
- a JSON attachment in `Products API › lists products`.

## Checks

`scripts/run-demo.mjs` exits with code 0 only when Playwright exits with code 1 and the report:

- has every outcome of the table above, and every other test passed;
- has no run error, 45 to 55 tests, and the skip kinds above;
- has an error group shared by three tests, every category of the table, the dimensions, a nested step, a screenshot comparison, a video and a trace;
- shows exactly one common failure point, `signIn`, once rendered;
- stays under 10 MB.

A test renamed, added or changed in outcome must be reflected in its lists.
