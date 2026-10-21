import { test } from '@playwright/test';
import { fetchResource } from '../../helpers/resources.js';

// Intentional failure through a shared helper: see fixtures/README.md. Do not "fix" this test.

test('loads the profile (intentional)', { tag: '@layer:api' }, async ({ request }) => {
  await fetchResource(request, '/api/profile', 503);
});
