import { expect, test } from '@playwright/test';

// Intentional outcomes: see fixtures/README.md. Do not "fix" these tests.

const PAGE = `
  <main>
    <h1>Loupe fixture</h1>
    <button type="button" onclick="this.textContent = 'Clicked'">Click me</button>
  </main>
`;

test.beforeEach(async ({ page }) => {
  await page.setContent(PAGE);
});

test.describe('basics', () => {
  test('shows the heading', { tag: '@layer:ui' }, async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Loupe fixture');
  });

  test('updates the button on click', { tag: '@layer:ui' }, async ({ page }) => {
    await page.getByRole('button').click();
    await expect(page.getByRole('button')).toHaveText('Clicked');
  });

  test('computes a value', { tag: '@layer:api' }, async () => {
    expect(1 + 1).toBe(2);
  });

  test('attaches a screenshot', { tag: '@layer:ui' }, async ({ page }, testInfo) => {
    await testInfo.attach('screenshot', { body: await page.screenshot(), contentType: 'image/png' });
  });

  test(
    'fails on a wrong heading (intentional)',
    { tag: '@layer:ui', annotation: { type: 'bug', description: 'BUG-1' } },
    async ({ page }) => {
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wrong heading', { timeout: 500 });
    },
  );
});
