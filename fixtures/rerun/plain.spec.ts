import { test } from '@playwright/test';

test('alpha', async () => {});
test('beta', async () => {});
test.describe('group', () => {
  test('gamma', { tag: '@tagged' }, async () => {});
});
