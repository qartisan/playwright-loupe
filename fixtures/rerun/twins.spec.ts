import { test } from '@playwright/test';

// Pairs `-g` cannot tell apart: they run together, the documented limit of the
// rerun commands. test/rerun.integration.test.ts lists them.
const body = async () => {};

test('login', body);
test('Login', body);
test.describe('outer', () => {
  test('same', body);
});
test('outer same', body);
test.describe('outer same', () => {
  test('leaf', body);
});
test('outer same leaf', body);
test('tail @smoke', body);
test('tail', { tag: '@smoke' }, body);
test('tail2', { tag: ['@a', '@b:c'] }, body);
test('tail2 @a', { tag: '@b:c' }, body);
