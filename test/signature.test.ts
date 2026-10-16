import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { errorSignature, normalizeErrorMessage, stripAnsi } from '../src/core/signature.js';

const ESC = String.fromCharCode(27);

describe('stripAnsi', () => {
  it('removes color codes', () => {
    expect(stripAnsi(`${ESC}[31mExpected${ESC}[39m: ${ESC}[1m"a"${ESC}[22m`)).toBe('Expected: "a"');
  });

  it('leaves plain text untouched', () => {
    expect(stripAnsi('plain [text] (1)')).toBe('plain [text] (1)');
  });
});

describe('normalizeErrorMessage', () => {
  const cases: Array<[string, string, string]> = [
    ['UUIDs', 'Order 3f2b8c1e-9a4d-4e5f-8b6a-1c2d3e4f5a6b failed', 'Order <uuid> failed'],
    ['uppercase UUIDs', 'id 3F2B8C1E-9A4D-4E5F-8B6A-1C2D3E4F5A6B', 'id <uuid>'],
    ['http URLs', 'GET https://api.example.com/v1/users?id=42&x=y failed', 'GET <url> failed'],
    ['URLs with a port', 'connect to http://localhost:3000/health refused', 'connect to <url> refused'],
    ['ws URLs', 'socket ws://127.0.0.1:9222/devtools closed', 'socket <url> closed'],
    ['trailing punctuation after a URL', 'Navigated to https://example.com/a.', 'Navigated to <url>.'],
    ['quoted URLs', 'expected "https://example.com/a"', 'expected "<url>"'],
    ['ISO dates', 'on 2024-03-01', 'on <date>'],
    ['ISO date-times', 'at 2024-03-01T12:34:56.789Z done', 'at <date> done'],
    ['ISO date-times with offset', 'at 2024-03-01T12:34:56+02:00', 'at <date>'],
    ['times of day', 'started 09:15:02 and ended', 'started <date> and ended'],
    ['millisecond timestamps', 'created 1717171717171', 'created <date>'],
    ['second timestamps', 'created 1717171717', 'created <date>'],
    ['durations in ms', 'Timeout 5000ms exceeded.', 'Timeout <duration> exceeded.'],
    ['durations in seconds', 'waited 5s, then 2.5 s, then 3 seconds', 'waited <duration>, then <duration>, then <duration>'],
    ['durations in minutes and hours', 'after 2m or 1 hour', 'after <duration> or <duration>'],
    ['hex strings', 'commit a1b2c3d4e5f6 is missing', 'commit <hex> is missing'],
    ['hex without digits', 'token deadbeef expired', 'token <hex> expired'],
    ['long numbers as numbers, not hex', 'order 12345678 missing', 'order <n> missing'],
    ['short hex-like words untouched', 'a cafe bed face', 'a cafe bed face'],
    ['POSIX paths', 'ENOENT: open /home/ci/work/app/fixtures/user.json', 'ENOENT: open <path>'],
    ['paths with line and column', 'at /repo/tests/a.spec.ts:12:5', 'at <path>:<n>:<n>'],
    ['Windows paths', 'cannot read C:\\Users\\ci\\app\\data.json now', 'cannot read <path> now'],
    ['Windows paths with forward slashes', 'open C:/Users/ci/data.json', 'open <path>'],
    ['remaining numbers', 'Expected: 3 Received: 4', 'Expected: <n> Received: <n>'],
    ['decimal numbers', 'ratio 0.02 of all pixels', 'ratio <n> of all pixels'],
    ['numbers inside identifiers', 'locator #item-42 and h1', 'locator #item-<n> and h<n>'],
    ['whitespace', '  Expected:\n\n   "a"\t\tReceived:  "b"  ', 'Expected: "a" Received: "b"'],
  ];

  it.each(cases)('replaces %s', (_label, input, expected) => {
    expect(normalizeErrorMessage(input)).toBe(expected);
  });

  describe('e-mail addresses', () => {
    it.each([
      ['a plain address', 'User jane.doe@example.com already exists', 'User <email> already exists'],
      ['plus addressing with a timestamp', 'invite qa+1717171717171@test.example.org failed', 'invite <email> failed'],
      ['an address in quotes', 'Expected: "a_b-c@mail.co.uk"', 'Expected: "<email>"'],
      ['an address before a period', 'Sent to ops@example.com.', 'Sent to <email>.'],
      ['an address after the merge-reports prefix is stripped', '(@chromium) no user x@y.io', 'no user <email>'],
    ])('replaces %s', (_label, input, expected) => {
      expect(normalizeErrorMessage(input, { runError: true })).toBe(expected);
    });

    it.each([
      ['a tag', 'tagged @layer:api', 'tagged @layer:api'],
      ['a scoped package', "Cannot find module '@scope/pkg'", "Cannot find module '@scope/pkg'"],
      ['a host without a dot', 'login as admin@localhost', 'login as admin@localhost'],
      ['a decorator-like word', 'foo@bar is not a function', 'foo@bar is not a function'],
    ])('keeps %s', (_label, input, expected) => {
      expect(normalizeErrorMessage(input)).toBe(expected);
    });

    it('keeps an address inside a URL as part of the URL', () => {
      expect(normalizeErrorMessage('GET https://api.example.com/users?email=a@b.com failed')).toBe('GET <url> failed');
    });

    it('gives the same signature to the same failure for different users', () => {
      expect(errorSignature('User test-1@example.com not found')).toBe(errorSignature('User qa.42@corp.example.net not found'));
    });
  });

  describe('identifiers', () => {
    it.each([
      ['cuid v1', 'Order cjld2cjxh0000qzrmn831i7rn not found', 'Order <id> not found'],
      ['cuid2', 'Order tz4a98xxat96iws9zmbrgj3a not found', 'Order <id> not found'],
      ['nanoid', 'Session V1StGXR8_Z5jdHi6B-myT expired', 'Session <id> expired'],
      ['a nanoid starting with a separator', 'token -x8Kq2LmNpRt5VwYz3Ab9 revoked', 'token <id> revoked'],
      ['an id inside a quoted locator', `getByTestId('row-cjld2cjxh0000qzrmn831i7rn')`, `getByTestId('row-<id>')`],
      ['an id after an underscore', 'record user_tz4a98xxat96iws9zmbrgj3a', 'record user_<id>'],
    ])('replaces %s', (_label, input, expected) => {
      expect(normalizeErrorMessage(input)).toBe(expected);
    });

    it.each([
      ['long words', 'toHaveAccessibleDescription internationalization', 'toHaveAccessibleDescription internationalization'],
      ['long camelCase words', 'expect(locator).toHaveAccessibleErrorMessage failed', 'expect(locator).toHaveAccessibleErrorMessage failed'],
      ['kebab-case names with numbers', 'checkout-step-2-payment-form-submit', 'checkout-step-<n>-payment-form-submit'],
      ['snake_case names with numbers', 'ORDER_STATUS_2_PENDING_REVIEW', 'ORDER_STATUS_<n>_PENDING_REVIEW'],
      ['short mixed tokens', 'build Xy12Kq34Zw56', 'build Xy<n>Kq<n>Zw<n>'],
      ['timings', 'Timeout 429ms exceeded after 1500 ms', 'Timeout <duration> exceeded after <duration>'],
    ])('keeps %s', (_label, input, expected) => {
      expect(normalizeErrorMessage(input)).toBe(expected);
    });

    it('keeps long hex strings as hex', () => {
      expect(normalizeErrorMessage('commit da39a3ee5e6b4b0d3255bfef95601890afd80709')).toBe('commit <hex>');
    });

    it('gives the same signature to the same failure on different records', () => {
      expect(errorSignature('Order cjld2cjxh0000qzrmn831i7rn not found')).toBe(
        errorSignature('Order ckx9qz1a20001abcdj3f8x7yp not found'),
      );
      expect(errorSignature('Session V1StGXR8_Z5jdHi6B-myT expired')).toBe(errorSignature('Session Uakgb_J5m9g-0JDMbcJqLJ expired'));
    });
  });

  it('does not treat a regex-like single segment as a path', () => {
    expect(normalizeErrorMessage('Expected pattern: /login/')).toBe('Expected pattern: /login/');
  });

  it('keeps text before the call log only', () => {
    const message = [
      'Error: locator.click: Timeout 1000ms exceeded.',
      'Call log:',
      "  - waiting for getByRole('button', { name: 'Pay' })",
      '    - locator resolved to <button id="b-42">Pay</button>',
    ].join('\n');
    expect(normalizeErrorMessage(message)).toBe('Error: locator.click: Timeout <duration> exceeded.');
  });

  it('strips ANSI codes first', () => {
    expect(normalizeErrorMessage(`${ESC}[2mexpect(${ESC}[22m${ESC}[31mreceived${ESC}[39m) 3`)).toBe(
      'expect(received) <n>',
    );
  });

  it('normalizes a realistic Playwright assertion message', () => {
    const message = [
      `Error: ${ESC}[2mexpect(${ESC}[22m${ESC}[31mlocator${ESC}[39m${ESC}[2m).${ESC}[22mtoHaveText${ESC}[2m(${ESC}[22m${ESC}[32mexpected${ESC}[39m${ESC}[2m)${ESC}[22m failed`,
      '',
      "Locator: getByRole('heading', { level: 1 })",
      'Expected: "Wrong heading"',
      'Received: "Loupe fixture"',
      'Timeout: 500ms',
      '',
      'Call log:',
      '  - Expect "toHaveText" with timeout 500ms',
    ].join('\n');
    expect(normalizeErrorMessage(message)).toBe(
      "Error: expect(locator).toHaveText(expected) failed Locator: getByRole('heading', { level: <n> }) Expected: \"Wrong heading\" Received: \"Loupe fixture\"",
    );
  });

  it('applies URL replacement before paths', () => {
    expect(normalizeErrorMessage('file:///home/ci/app/index.html not found')).toBe('<url> not found');
  });

  it('handles an empty message', () => {
    expect(normalizeErrorMessage('')).toBe('');
  });

  describe('merge-reports tag prefix on run errors', () => {
    const message = "Error: Cannot find module './missing.js'";

    it.each([
      ['one tag', '(@chromium) '],
      ['several tags', '(@chromium @nightly) '],
      ['a tag with a space', '(@my tag) '],
    ])('strips %s', (_label, prefix) => {
      expect(normalizeErrorMessage(prefix + message, { runError: true })).toBe(normalizeErrorMessage(message));
    });

    it('strips it from a message with ANSI codes', () => {
      expect(normalizeErrorMessage(`(@a) ${ESC}[31mboom${ESC}[39m`, { runError: true })).toBe('boom');
    });

    it('strips only the first prefix', () => {
      expect(normalizeErrorMessage('(@a) (@b) boom', { runError: true })).toBe('(@b) boom');
    });

    it('keeps it on test errors', () => {
      expect(normalizeErrorMessage('(@chromium) boom')).toBe('(@chromium) boom');
    });

    it.each([
      ['parentheses not starting with @', '(intermediate value) is not a function'],
      ['a prefix not at the start', 'Error: (@chromium) boom'],
      ['no space after the prefix', '(@chromium)boom'],
      ['a prefix spanning lines', '(@a\nb) boom'],
    ])('keeps %s', (_label, input) => {
      expect(normalizeErrorMessage(input, { runError: true })).toBe(normalizeErrorMessage(input));
    });
  });
});

describe('errorSignature', () => {
  it('is the first 12 hex chars of sha256 of the normalized message', () => {
    const expected = createHash('sha256').update('Timeout <duration> exceeded.').digest('hex').slice(0, 12);
    expect(errorSignature('Timeout 5000ms exceeded.')).toBe(expected);
  });

  it('is the same when only volatile values differ', () => {
    const a = 'Order sync 3f2b8c1e-9a4d-4e5f-8b6a-1c2d3e4f5a6b rejected by http://localhost:3001/api/orders/12 after 250ms';
    const b = 'Order sync 0e0e0e0e-1111-4222-8333-444455556666 rejected by http://localhost:8443/api/orders/9001 after 4999ms';
    expect(errorSignature(a)).toBe(errorSignature(b));
  });

  it('ignores the call log and whitespace', () => {
    expect(errorSignature('Timeout 1000ms exceeded.\nCall log:\n  - a')).toBe(errorSignature('Timeout  2000ms exceeded.'));
  });

  it('is the same for a run error with or without the merge-reports tag prefix', () => {
    expect(errorSignature('(@shard-a) Error: boom', { runError: true })).toBe(errorSignature('Error: boom'));
    expect(errorSignature('(@shard-a) Error: boom')).not.toBe(errorSignature('Error: boom'));
  });

  it('differs when the meaningful text differs', () => {
    expect(errorSignature('Expected: "a"')).not.toBe(errorSignature('Expected: "b"'));
  });
});

/**
 * A strict mode violation on a test and its retry: the page gained an item
 * between the attempts, so the element count, the positions in the element
 * list (`.first()` / `.nth(1)`, `li:nth-child(13)` / `14`) and the items differ.
 * Playwright 1.64 format.
 */
const STRICT_FIRST_RUN = [
  "Error: locator.click: Error: strict mode violation: getByRole('listitem').filter({ hasText: 'Pending' }) resolved to 2 elements:",
  "    1) <li class=\"order pending\">Order 41 · Pending</li> aka getByRole('listitem').filter({ hasText: 'Order 41 · Pending' }).first()",
  "    2) <li class=\"order pending\">Order 42 · Pending</li> aka locator('li:nth-child(13)')",
  '',
  'Call log:',
  "  - waiting for getByRole('listitem').filter({ hasText: 'Pending' })",
].join('\n');

const STRICT_RETRY = [
  "Error: locator.click: Error: strict mode violation: getByRole('listitem').filter({ hasText: 'Pending' }) resolved to 3 elements:",
  "    1) <li class=\"order pending\">Order 40 · Pending</li> aka getByRole('listitem').filter({ hasText: 'Order 40 · Pending' })",
  "    2) <li class=\"order pending\">Order 41 · Pending</li> aka getByRole('listitem').filter({ hasText: 'Order 41 · Pending' }).nth(1)",
  "    3) <li class=\"order pending\">Order 42 · Pending</li> aka locator('li:nth-child(14)')",
  '',
  'Call log:',
  "  - waiting for getByRole('listitem').filter({ hasText: 'Pending' })",
].join('\n');

/** The same violation surfacing through a locator assertion. */
const strictAssertion = (count: number, nth: number) =>
  [
    'Error: expect(locator).toBeVisible() failed',
    '',
    "Locator: getByRole('listitem').filter({ hasText: 'Pending' })",
    'Expected: visible',
    'Timeout: 5000ms',
    `Error: strict mode violation: getByRole('listitem').filter({ hasText: 'Pending' }) resolved to ${count} elements:`,
    ...Array.from({ length: count }, (_, index) => `    ${index + 1}) <li>Order ${40 + index}</li> aka locator('li:nth-child(${nth + index})')`),
    '',
    'Call log:',
    '  - Expect "toBeVisible" with timeout 5000ms',
  ].join('\n');

describe('stable part of Playwright messages', () => {
  it('gives a strict mode violation the same signature on a test and its retry', () => {
    expect(errorSignature(STRICT_RETRY)).toBe(errorSignature(STRICT_FIRST_RUN));
    expect(normalizeErrorMessage(STRICT_FIRST_RUN)).toBe(
      "Error: locator.click: Error: strict mode violation: getByRole('listitem').filter({ hasText: 'Pending' }) resolved to <n> elements:",
    );
  });

  it('gives a strict mode violation through an assertion the same signature on a test and its retry', () => {
    expect(errorSignature(strictAssertion(3, 14))).toBe(errorSignature(strictAssertion(2, 13)));
    expect(normalizeErrorMessage(strictAssertion(2, 13))).toBe(
      "Error: expect(locator).toBeVisible() failed Locator: getByRole('listitem').filter({ hasText: 'Pending' }) Expected: visible " +
        "Error: strict mode violation: getByRole('listitem').filter({ hasText: 'Pending' }) resolved to <n> elements:",
    );
  });

  it('drops the "..." line ending a long element list', () => {
    const long = `${STRICT_FIRST_RUN.split('\nCall log:')[0]}\n    ...\n`;
    expect(errorSignature(long)).toBe(errorSignature(STRICT_FIRST_RUN));
  });

  it('keeps the matcher, Locator, Expected and Received lines of a locator assertion, and drops the rest', () => {
    const message = [
      'Error: expect(locator).toHaveScreenshot(expected) failed',
      '',
      "Locator: locator('div')",
      '  10000 pixels (ratio 1.00 of all image pixels) are different.',
      '',
      '  Snapshot: square.png',
      'Expected string: "a"',
      'Received string: "b"',
    ].join('\n');
    expect(normalizeErrorMessage(message)).toBe(
      "Error: expect(locator).toHaveScreenshot(expected) failed Locator: locator('div') Expected string: \"a\" Received string: \"b\"",
    );
  });

  it('keeps the matcher line after a custom assertion message', () => {
    const message = "Error: cart badge\n\nexpect(locator).toBeVisible() failed\n\nLocator: getByTestId('badge')\nExpected: visible";
    expect(normalizeErrorMessage(message)).toBe("Error: cart badge expect(locator).toBeVisible() failed Locator: getByTestId('badge') Expected: visible");
  });

  describe('still tells different failures apart', () => {
    it('different locators in a strict mode violation', () => {
      const other = STRICT_FIRST_RUN.replaceAll("hasText: 'Pending' })", "hasText: 'Shipped' })");
      expect(errorSignature(other)).not.toBe(errorSignature(STRICT_FIRST_RUN));
    });

    it('different locators in an assertion', () => {
      const a = "Error: expect(locator).toBeVisible() failed\n\nLocator: getByRole('button', { name: 'Pay' })\nExpected: visible";
      const b = "Error: expect(locator).toBeVisible() failed\n\nLocator: getByRole('button', { name: 'Cancel' })\nExpected: visible";
      expect(errorSignature(a)).not.toBe(errorSignature(b));
    });

    it('a missing element and several elements on the same locator', () => {
      const notFound = [
        'Error: expect(locator).toBeVisible() failed',
        '',
        "Locator: getByRole('listitem').filter({ hasText: 'Pending' })",
        'Expected: visible',
        'Timeout: 5000ms',
        'Error: element(s) not found',
      ].join('\n');
      expect(errorSignature(notFound)).not.toBe(errorSignature(strictAssertion(2, 13)));
    });

    it('different expected or received values', () => {
      const text = (expected: string) => `Error: expect(locator).toHaveText(expected) failed\n\nLocator: locator('h1')\nExpected: "${expected}"\nReceived: "Home"`;
      expect(errorSignature(text('Checkout'))).not.toBe(errorSignature(text('Cart')));
    });

    it('different actions on the same strict mode violation', () => {
      expect(errorSignature(STRICT_FIRST_RUN.replace('locator.click', 'locator.fill'))).not.toBe(errorSignature(STRICT_FIRST_RUN));
    });
  });

  it('leaves numbered lines alone outside strict mode violations, and messages without Locator line whole', () => {
    const message = 'Error: Import failed\n  1) <row id=7> rejected: missing SKU\n  2) <row id=9> rejected: bad price';
    expect(normalizeErrorMessage(message)).toBe(
      'Error: Import failed <n>) <row id=<n>> rejected: missing SKU <n>) <row id=<n>> rejected: bad price',
    );
    const deepEqual = 'Error: expect(received).toEqual(expected) // deep equality\n\n- Expected  - 1\n+ Received  + 1\n\n  Object {\n-   "total": 10,\n+   "total": 12,\n  }';
    expect(normalizeErrorMessage(deepEqual)).toContain('"total"');
  });
});
