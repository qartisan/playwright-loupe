import { describe, expect, it } from 'vitest';
import { BUILT_IN_RULES, UNCATEGORIZED, categorize, usedCategories } from '../src/core/categories.js';

const at = (message: string, stack: string | null = null) => ({ message, stack });

// Messages as Playwright 1.64 reports them (ANSI codes stripped).
const MESSAGES = {
  assertion: [
    'Error: expect(locator).toHaveText(expected) failed',
    '',
    "Locator: getByRole('heading', { level: 1 })",
    'Expected: "Wrong heading"',
    'Received: "Loupe fixture"',
    'Timeout: 500ms',
    '',
    'Call log:',
    '  - Expect "toHaveText" with timeout 500ms',
  ].join('\n'),
  screenshot:
    "Error: expect(locator).toHaveScreenshot(expected) failed\n\nLocator: locator('div')\n  10000 pixels (ratio 0.25 of all image pixels) are different.",
  generic: 'Error: fails on purpose\n\nexpect(received).toBeGreaterThan(expected)\n\nExpected: > 0\nReceived:   0',
  locator: [
    'Error: expect(locator).toBeVisible() failed',
    '',
    "Locator: getByRole('button', { name: 'Missing' })",
    'Expected: visible',
    'Timeout: 300ms',
    'Error: element(s) not found',
  ].join('\n'),
  testTimeout: 'Test timeout of 1000ms exceeded.',
  actionTimeout: "Error: locator.click: Timeout 1000ms exceeded.\nCall log:\n  - waiting for getByRole('button')",
  network: 'Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:37989/',
} as const;

describe('categorize', () => {
  it.each([
    ['assertion', 'Assertion'],
    ['screenshot', 'Assertion'],
    ['generic', 'Assertion'],
    ['locator', 'Locator not found'],
    ['testTimeout', 'Timeout'],
    ['actionTimeout', 'Timeout'],
    ['network', 'Network'],
  ] as const)('puts the %s message in %s', (key, category) => {
    expect(categorize(at(MESSAGES[key]))).toBe(category);
  });

  it.each([
    'Error: connect ECONNREFUSED 127.0.0.1:5432',
    'Error: getaddrinfo ENOTFOUND api.internal',
    'FetchError: socket hang up',
    'TypeError: fetch failed',
    'Error: page.goto: NS_ERROR_CONNECTION_REFUSED',
    'Error: connect ETIMEDOUT 10.0.0.1:443',
  ])('treats %j as a network error', (message) => {
    expect(categorize(at(message))).toBe('Network');
  });

  it('puts unmatched errors in Uncategorized', () => {
    expect(categorize(at('Error: Order sync 42 rejected'))).toBe(UNCATEGORIZED.name);
    expect(categorize(at(''))).toBe(UNCATEGORIZED.name);
  });

  it('also matches on the stack', () => {
    expect(categorize(at('Error: wrapped', 'Error: wrapped\n    caused by: net::ERR_ABORTED\n    at x.ts:1:1'))).toBe(
      'Network',
    );
  });

  it('applies rules in order: first match wins', () => {
    // Matches both "Locator not found" and "Assertion"; the earlier rule wins.
    expect(categorize(at('expect(locator).toBeVisible() failed\nError: element(s) not found'))).toBe(
      'Locator not found',
    );
    // A retrying assertion mentions a timeout but is an assertion failure.
    expect(categorize(at(MESSAGES.assertion))).toBe('Assertion');
  });

  it('accepts custom rules', () => {
    const rules = [{ name: 'Auth', color: '#000000', match: [/401/] }];
    expect(categorize(at('status 401'), rules)).toBe('Auth');
    expect(categorize(at('status 500'), rules)).toBe(UNCATEGORIZED.name);
  });
});

describe('built-in rules', () => {
  it('are timeout, locator not found, network and assertion, with distinct colors', () => {
    expect(BUILT_IN_RULES.map((rule) => rule.name).sort()).toEqual(
      ['Assertion', 'Locator not found', 'Network', 'Timeout'].sort(),
    );
    const colors = [...BUILT_IN_RULES.map((rule) => rule.color), UNCATEGORIZED.color];
    expect(new Set(colors).size).toBe(colors.length);
  });
});

describe('usedCategories', () => {
  it('lists only used categories, in rule order, Uncategorized last', () => {
    const used = new Set(['Uncategorized', 'Timeout', 'Locator not found']);
    expect(usedCategories(used).map((category) => category.name)).toEqual([
      'Locator not found',
      'Timeout',
      'Uncategorized',
    ]);
    expect(usedCategories(used).every((category) => category.builtIn)).toBe(true);
  });

  it('is empty when nothing failed', () => {
    expect(usedCategories(new Set())).toEqual([]);
  });
});
