import { test } from '@playwright/test';
// @ts-expect-error Intentional: this module does not exist, so the file fails to load.
import { missingHelper } from './missing-helper.js';

// Intentional load error: see fixtures/README.md. Do not "fix" this file.

test('never runs', () => {
  missingHelper();
});
