import { test } from '@playwright/test';

// The `test.only` is intentional: see fixtures/README.md. Do not remove it.

test.only('runs alone', () => {});

test('is left out by test.only', () => {});
