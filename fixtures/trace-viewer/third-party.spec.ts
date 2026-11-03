import { expect, test } from '@playwright/test';

// A page holding what a trace viewer below Playwright 1.61 requests from its
// original host. Nothing here reaches a network: every host is invented and routed.

const PAGE = `<!doctype html><title>Third party</title>
<h1 id="marker">Rendered in a snapshot</h1>
<object data="https://object.third-party.test/secret-token" type="image/png"></object>
<embed src="https://embed.third-party.test/secret-token" type="image/png">
<button>Go</button>`;

test('shows a page with an object and an embed from another host', async ({ page }) => {
  await page.route(/third-party\.test/, (route) => route.abort());
  await page.route('https://app.test/', (route) => route.fulfill({ contentType: 'text/html', body: PAGE }));
  await page.goto('https://app.test/');
  await page.getByRole('button', { name: 'Go' }).click();
  await expect(page.locator('#marker')).toBeVisible();
});
