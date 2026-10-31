import { test } from '@playwright/test';
import { FIXTURE_SECRET } from '../redaction-values.js';

// The report hides the value of a variable listed in `redact.env`, here in
// titles: the command stands for it with `.+`, which leaves the others out.
const body = async () => {};

test(`with the secret ${FIXTURE_SECRET}`, body);
// Reads the same in the report: they run together, the documented limit.
test('with the secret [redacted]', body);
test('with the secret', body);
test(`${FIXTURE_SECRET} at the start, and ${FIXTURE_SECRET} again`, body);
test.describe(`in ${FIXTURE_SECRET} here`, () => {
  test('leaf', body);
});
test.describe('in here', () => {
  test('leaf', body);
});
