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

  describe('UUIDs', () => {
    const UUID = 'ecee1df6-5f3d-4737-a73b-bf708e305e50';
    it.each([
      ['an underscore prefix', `evt_${UUID}`, 'evt_<uuid>'],
      ['a letter prefix (not a hex digit)', `tx${UUID}`, 'tx<uuid>'],
      ['an equals prefix', `id=${UUID}`, 'id=<uuid>'],
      ['a req- prefix', `req-${UUID}`, 'req-<uuid>'],
      ['an evt- prefix', `evt-${UUID}`, 'evt-<uuid>'],
      ['nothing, with a hyphen suffix followed by a non-hex character', `${UUID}-retry`, '<uuid>-retry'],
      ['escaped JSON', `{\\"id\\":\\"evt_${UUID}\\"}`, '{\\"id\\":\\"evt_<uuid>\\"}'],
      ['uppercase', `EVT_${UUID.toUpperCase()}`, 'EVT_<uuid>'],
      ['the whole string', UUID, '<uuid>'],
      ['the start and end of the string', `${UUID} then ${UUID}`, '<uuid> then <uuid>'],
    ])('replaces a UUID after %s', (_label, input, expected) => {
      expect(normalizeErrorMessage(input)).toBe(expected);
    });

    it('does not take a UUID-like part of a longer hex run', () => {
      expect(normalizeErrorMessage(`a${UUID}`)).not.toContain('<uuid>');
      // `d` is a hex digit: `id` glued to a UUID makes a longer hex run.
      expect(normalizeErrorMessage(`id${UUID}`)).not.toContain('<uuid>');
      expect(normalizeErrorMessage(`${UUID}0`)).not.toContain('<uuid>');
      // A hyphen joins the UUID to a hex run when a hex digit touches it.
      expect(normalizeErrorMessage(`ab-${UUID}`)).not.toContain('<uuid>');
      expect(normalizeErrorMessage(`abc-${UUID}`)).not.toContain('<uuid>');
      expect(normalizeErrorMessage(`${UUID}-abc`)).not.toContain('<uuid>');
    });
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

  it('gives a test and its retry the same signature when only generated values differ (webhook event, anonymized)', () => {
    // A received value dump: port, timestamps, epoch milliseconds, an event id
    // `evt_<uuid>`, cuids, e-mails and numbered test data all differ.
    const message = (port: number, at: string, epoch: number, eventId: string, cuids: [string, string, string], user: number, ticket: number) =>
      [
        'Error: expect(received).rejects.toThrowError()',
        '',
        'Received promise resolved instead of rejected',
        `Resolved to value: {"headers": {"accept": "*/*", "content-type": "application/json", "host": "127.0.0.1:${port}", "x-acme-timestamp": "${at}"}, "method": "POST", ` +
          `"rawBody": "{\\"version\\":1,\\"id\\":\\"evt_${eventId}\\",\\"type\\":\\"ticket.created\\",\\"timestamp\\":\\"${at}\\",` +
          `\\"data\\":{\\"ticket\\":{\\"id\\":\\"${cuids[0]}\\",\\"title\\":\\"[TEST] TC-bugs_00${user} - bug_00${user}-mail@test.com - Ticket #${ticket}\\",` +
          `\\"projectId\\":\\"${cuids[1]}\\",\\"assigneeId\\":\\"${cuids[2]}\\"}}}", "receivedAt": ${epoch}}`,
      ].join('\n');
    const firstRun = message(36863, '2026-10-17T15:29:31.836Z', 1792250971839, 'ecee1df6-5f3d-4737-a73b-bf708e305e50', ['cmvcjycbw011rokq5pnpkbt1g', 'cmvcjyc6h011pokq5zukoj3ix', 'cmvcjyc15011nokq5tlqrdrzu'], 3, 0);
    const retry = message(39111, '2026-10-17T15:29:35.044Z', 1792250975046, '4cd53d33-f369-479c-aae2-ee49feba13cf', ['cmvcjyeui012wokq5jxjp4gdl', 'cmvcjydyu0128okq5ayw0jmqf', 'cmvcjydqs0126okq5kb1m4wr6'], 5, 3);
    expect(normalizeErrorMessage(firstRun)).toContain('\\"id\\":\\"evt_<uuid>\\"');
    expect(errorSignature(retry)).toBe(errorSignature(firstRun));
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

describe('HTTP status codes', () => {
  // Anonymized from real messages: API helpers of a consumer suite, Playwright's failOnStatusCode and fetch log.
  it.each([
    ['Error: [Teardown] Unable to delete the member with API with error 401', 'Error: [Teardown] Unable to delete the member with API with error 401'],
    ['Error: [Projects] Unable to create project with API. Status: 401. Error: [object Object]', 'Error: [Projects] Unable to create project with API. Status: 401. Error: [object Object]'],
    [
      'Error: [Setup] Unable to create a member with API - (Status 400) {\n  "error": "This user is already a member."\n}',
      'Error: [Setup] Unable to create a member with API - (Status 400) { "error": "This user is already a member." }',
    ],
    ['Error: apiRequestContext.get: 500 Internal Server Error', 'Error: apiRequestContext.get: 500 Internal Server Error'],
    ['Error: expect(response).toBeOK() failed\n\n← 401 Unauthorized', 'Error: expect(response).toBeOK() failed ← 401 Unauthorized'],
    ['Error: upstream answered HTTP/1.1 503', 'Error: upstream answered HTTP/1.1 503'],
    ['Error: statusCode=502 on retry 3', 'Error: statusCode=502 on retry <n>'],
    ['Error: {"status": 404, "id": 17}', 'Error: {"status": 404, "id": <n>}'],
    ['Error: Request failed with status code 422', 'Error: Request failed with status code 422'],
  ])('keeps the code of %j', (message, normalized) => {
    expect(normalizeErrorMessage(message)).toBe(normalized);
  });

  it.each([
    ['Error: expect(received).toBe(expected)\n\nExpected: 200\nReceived: 500', 'Error: expect(received).toBe(expected) Expected: <n> Received: <n>'],
    ['Error: [Teardown] Unable to transition ticket -> (401) - { "error": "Invalid token" }', 'Error: [Teardown] Unable to transition ticket -> (<n>) - { "error": "Invalid token" }'],
    ['Error: Timeout 429ms exceeded.', 'Error: Timeout <duration> exceeded.'],
    ['Error: error 1234 in the queue', 'Error: error <n> in the queue'],
    ['Error: error 600 and status 99', 'Error: error <n> and status <n>'],
    ['Error: found 404 records, 200 OK lines', 'Error: found <n> records, 200 OK lines'],
    ['TypeError: 500 is not a function', 'TypeError: <n> is not a function'],
  ])('normalizes the other numbers of %j', (message, normalized) => {
    expect(normalizeErrorMessage(message)).toBe(normalized);
  });

  it('gives a 401 and a 500 in an HTTP context different signatures, and the same status the same one', () => {
    const failure = (status: number, id: string) => `Error: [Teardown] Unable to delete the member ${id} with API with error ${status}`;
    expect(errorSignature(failure(401, 'cmvhqm1a40011noq5auos3c5p'))).not.toBe(errorSignature(failure(500, 'cmvhqm1a40011noq5auos3c5p')));
    expect(errorSignature(failure(401, 'cmvhqm1a40011noq5auos3c5p'))).toBe(errorSignature(failure(401, 'tz4a98xxat96iws9zmbrgj3a')));
    expect(errorSignature('Error: expect(received).toBe(expected)\n\nExpected: 200\nReceived: 401')).toBe(
      errorSignature('Error: expect(received).toBe(expected)\n\nExpected: 200\nReceived: 500'),
    );
  });
});

describe('toBeOK() response status', () => {
  // Anonymized from Playwright 1.52 and 1.64 messages (local server, invented paths and bodies).
  const MATCHER = { '1.52': 'Error: expect(received).toBeOK()', '1.64': 'Error: expect(response).toBeOK() failed\n\n' };

  /** One request / response pair of the call log, as Playwright logs it. */
  function hop(method: string, url: string, response: string, headers: string[] = []): string {
    return [
      `→ ${method} ${url}`,
      '  user-agent: Playwright/1.64.1 (x64; linux) node/24.17',
      '  accept: */*',
      '  accept-encoding: gzip,deflate,br',
      `← ${response}`,
      ...headers,
      '  date: Wed, 21 Oct 2026 16:39:30 GMT',
      '  connection: keep-alive',
      '  keep-alive: timeout=5',
      '  transfer-encoding: chunked',
    ].join('\n');
  }

  function toBeOK(response: string, options: { version?: '1.52' | '1.64'; url?: string; method?: string; body?: string; head?: string; redirects?: string[] } = {}): string {
    const { version = '1.64', url = 'http://127.0.0.1:41733/api/orders', method = 'GET', body, head = MATCHER[version], redirects = [] } = options;
    const hops = [
      ...redirects.map((location, index) => hop(method, index === 0 ? url : redirects[index - 1] ?? url, '302 Found', [`  location: ${location}`])),
      hop(method, redirects.at(-1) ?? url, response, body ? ['  content-type: application/json'] : []),
    ];
    return [head, 'Call log:', ...hops, '', ...(body ? ['Response text:', body] : [])].join('\n');
  }

  it.each(['1.52', '1.64'] as const)('gives a 429, a 404 and a 503 different signatures, Playwright %s', (version) => {
    const signatures = ['429 Too Many Requests', '404 Not Found', '503 Service Unavailable'].map((status) => errorSignature(toBeOK(status, { version })));
    expect(new Set(signatures).size).toBe(3);
    expect(normalizeErrorMessage(toBeOK('503 Service Unavailable', { version }))).toBe(`${MATCHER[version].trim()} ← 503 Service Unavailable`);
  });

  it('gives the same status on different endpoints, methods and bodies one signature', () => {
    const base = errorSignature(toBeOK('503 Service Unavailable'));
    expect(errorSignature(toBeOK('503 Service Unavailable', { url: 'http://127.0.0.1:52011/api/invoices/42?token=[redacted]' }))).toBe(base);
    expect(errorSignature(toBeOK('503 Service Unavailable', { method: 'POST', body: '{"error":"maintenance","requestId":"req-91c2"}' }))).toBe(base);
    expect(errorSignature(toBeOK('503 Service Unavailable', { body: 'Upstream unavailable, retry later' }))).toBe(base);
  });

  it('keeps the last response only, after redirects', () => {
    const redirected = toBeOK('503 Service Unavailable', { redirects: ['/api/orders/v2', '/api/orders/v3?step=2'] });
    expect(normalizeErrorMessage(redirected)).toBe('Error: expect(response).toBeOK() failed ← 503 Service Unavailable');
    expect(errorSignature(redirected)).toBe(errorSignature(toBeOK('503 Service Unavailable')));
    expect(errorSignature(toBeOK('500 Internal Server Error', { redirects: ['/api/orders/v2'] }))).not.toBe(errorSignature(redirected));
  });

  it('keeps the status of not.toBeOK(), Playwright 1.52 and 1.64', () => {
    const notOk = (version: '1.52' | '1.64', status: string) =>
      toBeOK(status, { version, head: version === '1.52' ? 'Error: expect(received).not.toBeOK()' : 'Error: expect(response).not.toBeOK() failed\n\n' });
    expect(normalizeErrorMessage(notOk('1.52', '200 OK'))).toBe('Error: expect(received).not.toBeOK() ← 200 OK');
    expect(errorSignature(notOk('1.64', '200 OK'))).not.toBe(errorSignature(notOk('1.64', '204 No Content')));
  });

  it('keeps it after a custom message', () => {
    const custom = (status: string) => toBeOK(status, { head: 'Error: orders API should answer\n\nexpect(response).toBeOK() failed\n\n' });
    expect(normalizeErrorMessage(custom('502 Bad Gateway'))).toBe('Error: orders API should answer expect(response).toBeOK() failed ← 502 Bad Gateway');
    expect(errorSignature(custom('502 Bad Gateway'))).not.toBe(errorSignature(custom('503 Service Unavailable')));
  });

  it('keeps a non-standard reason phrase, normalized like any text', () => {
    expect(normalizeErrorMessage(toBeOK('503 Maintenance window 42'))).toBe('Error: expect(response).toBeOK() failed ← 503 Maintenance window <n>');
  });

  it('leaves messages that only mention toBeOK, and other call logs, unchanged', () => {
    // A user message quoting the matcher in its own text, with a call log of its own.
    const user = 'Error: expect(response).toBeOK() was skipped: ← 418 I am a teapot\nCall log:\n  - ← 500 Internal Server Error';
    expect(normalizeErrorMessage(user)).toBe('Error: expect(response).toBeOK() was skipped: ← 418 I am a teapot');
    // failOnStatusCode: the status is on the first line; its call log (`  - ← …`) stays cut.
    const request = 'Error: apiRequestContext.get: 500 Internal Server Error\nCall log:\n  - → GET http://127.0.0.1:41733/api/orders\n  - ← 500 Internal Server Error';
    expect(normalizeErrorMessage(request)).toBe('Error: apiRequestContext.get: 500 Internal Server Error');
    // Another matcher with a call log.
    const visible = "Error: expect(locator).toBeVisible() failed\n\nLocator: getByRole('button')\nExpected: visible\nCall log:\n  - ← 503 Service Unavailable";
    expect(normalizeErrorMessage(visible)).toBe("Error: expect(locator).toBeVisible() failed Locator: getByRole('button') Expected: visible");
    // A toBeOK() message without any response line keeps today's signature.
    expect(normalizeErrorMessage('Error: expect(response).toBeOK() failed\n\nCall log:\n  - waiting')).toBe('Error: expect(response).toBeOK() failed');
  });
});
