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
      "Error: expect(locator).toHaveText(expected) failed Locator: getByRole('heading', { level: <n> }) Expected: \"Wrong heading\" Received: \"Loupe fixture\" Timeout: <duration>",
    );
  });

  it('applies URL replacement before paths', () => {
    expect(normalizeErrorMessage('file:///home/ci/app/index.html not found')).toBe('<url> not found');
  });

  it('handles an empty message', () => {
    expect(normalizeErrorMessage('')).toBe('');
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

  it('differs when the meaningful text differs', () => {
    expect(errorSignature('Expected: "a"')).not.toBe(errorSignature('Expected: "b"'));
  });
});
