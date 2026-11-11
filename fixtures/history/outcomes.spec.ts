import { test } from '@playwright/test';

// One test per outcome a run file records. The failures are intentional.

test('passes', () => {});

test('fails (intentional)', () => {
  // Longer than an error extract, over several lines.
  const lines = Array.from({ length: 12 }, (_, index) => `line ${index + 1} of a long failure message, kept in the extract up to a line end`);
  throw new Error(`The order total is wrong (intentional)\n${lines.join('\n')}`);
});

test('is flaky (intentional)', () => {
  if (test.info().retry === 0) throw new Error('First attempt fails (intentional)');
});

test('is skipped', () => {
  test.skip(true, 'not in this run');
});

test('fails as expected', () => {
  test.fail();
  throw new Error('Expected failure');
});
