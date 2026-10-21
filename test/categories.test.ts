import { describe, expect, it } from 'vitest';
import type { ResolvedCategoryRule } from '../src/config/types.js';
import {
  BUILT_IN_RULES,
  DEFAULT_CATEGORIES,
  PALETTE,
  UNCATEGORIZED_COLOR,
  createCategorizer,
  type CategoriesOptions,
} from '../src/core/categories.js';
import { paletteReference } from '../src/shared/palette.js';

const at = (message: string, stack: string | null = null, step: string | null = null) => ({ message, stack, step });

const builtIn = createCategorizer(DEFAULT_CATEGORIES);
const categorize = builtIn.categorize;
const UNCATEGORIZED = { name: 'Uncategorized' };

const rule = (overrides: Partial<ResolvedCategoryRule> & { name: string }): ResolvedCategoryRule => ({
  match: [/never/],
  on: 'all',
  color: null,
  ...overrides,
});

const withRules = (rules: ResolvedCategoryRule[], options: Partial<CategoriesOptions> = {}) =>
  createCategorizer({ ...DEFAULT_CATEGORIES, rules, ...options });

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
  ambiguous: [
    "Error: locator.click: Error: strict mode violation: getByRole('button', { name: 'Save' }) resolved to 2 elements:",
    "    1) <button>Save</button> aka getByRole('button', { name: 'Save', exact: true })",
    "    2) <button>Save draft</button> aka getByRole('button', { name: 'Save draft' })",
  ].join('\n'),
  ambiguousExpect: [
    'Error: expect(locator).toBeVisible() failed',
    '',
    "Locator: getByRole('button', { name: 'Save' })",
    'Expected: visible',
    "Error: strict mode violation: getByRole('button', { name: 'Save' }) resolved to 2 elements:",
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
    ['ambiguous', 'Ambiguous locator'],
    ['ambiguousExpect', 'Ambiguous locator'],
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

  it.each([
    'Error: apiRequestContext.get: 429 Too Many Requests',
    'Error: expect(response).toBeOK() failed\n\nCall log:\n  - → GET https://api.example.com/orders\n  - \u2190 429 Too Many Requests',
    'Error: Request failed with status 429',
    'Error: Request failed with status code 429',
    'HTTPError: HTTP 429 on /orders',
    'Error: unexpected HTTP/1.1 429',
    'Error: Response status: 429',
    'Error: {"status": 429, "error": "slow down"}',
    'Error: statusCode=429',
    'Error: rate limit exceeded',
    'Error: API rate-limited, retry later',
  ])('treats %j as rate limited', (message) => {
    expect(categorize(at(message))).toBe('Rate limited');
  });

  it.each([
    'Error: apiRequestContext.post: 500 Internal Server Error',
    'Error: expect(response).toBeOK() failed\n\nCall log:\n  - \u2190 502 Bad Gateway',
    'Error: page.goto: 503 Service Unavailable',
    'Error: 504 Gateway Timeout',
    'Error: Request failed with status code 500',
    'Error: Response status: 599.',
    'HTTPError: HTTP 503',
    'Error: {"status":500}',
  ])('treats %j as a server error', (message) => {
    expect(categorize(at(message))).toBe('Server error');
  });

  it.each([
    ['a timing', 'Error: locator.click: Timeout 429ms exceeded.', 'Timeout'],
    ['a status without HTTP context', 'Error: expect(received).toBe(expected)\n\nExpected: 200\nReceived: 429', 'Assertion'],
    ['a 5xx without HTTP context', 'Error: expect(received).toBe(expected)\n\nExpected: 200\nReceived: 500', 'Assertion'],
    ['a number that only starts like a status', 'Error: Response status: 5000', 'Uncategorized'],
    ['a status outside 5xx', 'Error: Response status: 404', 'Uncategorized'],
    ['a status in a decimal', 'Error: status 500.5 out of range', 'Uncategorized'],
    ['a count of 500', 'Error: expected 500 rows', 'Uncategorized'],
  ])('does not treat %s as an HTTP failure', (_label, message, category) => {
    expect(categorize(at(message))).toBe(category);
  });

  it('puts HTTP status failures before network, assertion and timeout', () => {
    // A failed toBeOK() is an expect; a 504 mentions a timeout.
    expect(categorize(at('Error: expect(response).toBeOK() failed\n  - \u2190 500 Internal Server Error'))).toBe(
      'Server error',
    );
    expect(categorize(at('Error: 504 Gateway Timeout after Timeout 1000ms exceeded'))).toBe('Server error');
    expect(categorize(at('Error: status 429 then ECONNRESET'))).toBe('Rate limited');
    // Rate limited comes first: a 503 that says "rate limit" is rate limiting.
    expect(categorize(at('Error: 503 Service Unavailable: rate limit exceeded'))).toBe('Rate limited');
    // A missing element is still the diagnosis.
    expect(categorize(at('Error: element(s) not found after HTTP 500'))).toBe('Locator not found');
  });

  it('reads the HTTP context shared with error signatures: `error NNN` and reason phrases', () => {
    expect(categorize(at('Error: Unable to delete the member with API with error 503'))).toBe('Server error');
    expect(categorize(at('Error: error: 429 from the gateway'))).toBe('Rate limited');
    expect(categorize(at('Error: apiRequestContext.get: 502 Bad Gateway'))).toBe('Server error');
    // Still no HTTP context: a bare number, an error class name, another code.
    expect(categorize(at('Error: expect(received).toBe(expected)\n\nExpected: 200\nReceived: 500'))).toBe('Assertion');
    expect(categorize(at('TypeError: 500 is not a function'))).toBe('Uncategorized');
    expect(categorize(at('Error: Unable to delete the member with API with error 401'))).toBe('Uncategorized');
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
    // A strict mode violation is an ambiguous locator, before anything else.
    expect(categorize(at('Error: strict mode violation: x resolved to 2 elements\nError: element(s) not found'))).toBe(
      'Ambiguous locator',
    );
    // A retrying assertion mentions a timeout but is an assertion failure.
    expect(categorize(at(MESSAGES.assertion))).toBe('Assertion');
  });

  it('does not match built-in rules on step titles', () => {
    expect(categorize(at('Error: boom', null, 'wait until the request timed out'))).toBe(UNCATEGORIZED.name);
  });
});

describe('config rules', () => {
  it('run before the built-in rules in extend mode', () => {
    const categorizer = withRules([rule({ name: 'Infra', match: [/ECONNREFUSED/] })]);
    expect(categorizer.categorize(at('Error: connect ECONNREFUSED 127.0.0.1:5432'))).toBe('Infra');
    // Built-in rules still apply to everything else.
    expect(categorizer.categorize(at(MESSAGES.network))).toBe('Network');
    expect(categorizer.categorize(at(MESSAGES.testTimeout))).toBe('Timeout');
  });

  it('drop the built-in rules in replace mode', () => {
    const categorizer = withRules([rule({ name: 'Infra', match: [/ECONNREFUSED/] })], { mode: 'replace' });
    expect(categorizer.categorize(at('Error: connect ECONNREFUSED 127.0.0.1:5432'))).toBe('Infra');
    expect(categorizer.categorize(at(MESSAGES.network))).toBe(UNCATEGORIZED.name);
    expect(categorizer.categorize(at(MESSAGES.assertion))).toBe(UNCATEGORIZED.name);
  });

  it('match when any of their patterns matches', () => {
    const categorizer = withRules([rule({ name: 'Auth', match: [/401/, /session-token/] })]);
    expect(categorizer.categorize(at('status 401'))).toBe('Auth');
    expect(categorizer.categorize(at('missing session-token'))).toBe('Auth');
  });

  it('use the configured uncategorized name', () => {
    const categorizer = withRules([], { uncategorized: 'To triage' });
    expect(categorizer.categorize(at('Error: Order sync 42 rejected'))).toBe('To triage');
    expect(categorizer.definitions(new Set(['To triage']))).toEqual([
      { name: 'To triage', color: UNCATEGORIZED_COLOR, builtIn: true },
    ]);
  });

  describe('on', () => {
    const error = at('Error: message text', 'Error: message text\n    at stack-frame.ts:1:1', 'log in\nclick submit');
    const target = (on: ResolvedCategoryRule['on'], pattern: RegExp): string =>
      withRules([rule({ name: 'Hit', match: [pattern], on })], { mode: 'replace' }).categorize(error);

    it.each([
      ['message', /message text/, 'Hit'],
      ['message', /stack-frame/, 'Uncategorized'],
      ['message', /log in/, 'Uncategorized'],
      ['stack', /stack-frame/, 'Hit'],
      ['stack', /log in/, 'Uncategorized'],
      ['step', /^click submit$/m, 'Hit'],
      ['step', /message text/, 'Uncategorized'],
      ['all', /message text/, 'Hit'],
      ['all', /stack-frame/, 'Hit'],
      ['all', /click submit/, 'Hit'],
    ] as const)('on %s with %s gives %s', (on, pattern, expected) => {
      expect(target(on, pattern)).toBe(expected);
    });

    it('never matches a step rule when there is no failing step', () => {
      const categorizer = withRules([rule({ name: 'Hit', match: [/.*/], on: 'step' })], { mode: 'replace' });
      expect(categorizer.categorize(at('Error: x'))).toBe('Uncategorized');
    });
  });
});

describe('category colors', () => {
  it('keep the configured color, and the built-in colors', () => {
    const categorizer = withRules([rule({ name: 'Infra', color: '#123456', match: [/x/] })]);
    const definitions = categorizer.definitions(new Set(['Infra', 'Network']));
    expect(definitions).toEqual([
      { name: 'Infra', color: '#123456', builtIn: false },
      { name: 'Network', color: paletteReference('cyan'), builtIn: true },
    ]);
  });

  it('come from the palette, in rule order, for rules without color', () => {
    const categorizer = withRules(
      [rule({ name: 'A' }), rule({ name: 'B', color: PALETTE[1] as string }), rule({ name: 'C' })],
      { mode: 'replace' },
    );
    const colors = Object.fromEntries(categorizer.definitions(new Set(['A', 'B', 'C'])).map((d) => [d.name, d.color]));
    // C skips the palette color B already uses.
    expect(colors).toEqual({ A: PALETTE[0], B: PALETTE[1], C: PALETTE[2] });
  });

  it('are shared among the categories a report uses: a color is free when its category is not in the report', () => {
    const categorizer = withRules([rule({ name: 'A' }), rule({ name: 'B' })]);
    // Assertion (blue, PALETTE[0]) is not used, so A gets it; Network (cyan, PALETTE[1]) is, so B skips it.
    const definitions = categorizer.definitions(new Set(['A', 'B', 'Network']));
    expect(definitions.map((d) => [d.name, d.color])).toEqual([
      ['A', PALETTE[0]],
      ['B', PALETTE[2]],
      ['Network', PALETTE[1]],
    ]);
  });

  it('give distinct colors to the categories of a report as long as the palette lasts', () => {
    const rules = Array.from({ length: PALETTE.length - 4 }, (_, index) => rule({ name: `R${index}` }));
    const used = new Set([...rules.map((r) => r.name), ...BUILT_IN_RULES.slice(0, 4).map((r) => r.name)]);
    const colors = withRules(rules).definitions(used).map((d) => d.color);
    expect(colors).toHaveLength(PALETTE.length);
    expect(new Set(colors).size).toBe(PALETTE.length);
  });

  it('wrap around when the palette is exhausted', () => {
    const rules = Array.from({ length: PALETTE.length + 1 }, (_, index) => rule({ name: `R${index}` }));
    const definitions = withRules(rules, { mode: 'replace' }).definitions(new Set(rules.map((r) => r.name)));
    expect(definitions.map((d) => d.color)).toEqual([...PALETTE, PALETTE[0]]);
  });

  it('let a config rule named like a built-in one recolor it, the built-in patterns still applying', () => {
    const categorizer = withRules([rule({ name: 'Network', color: '#000000', match: [/upstream down/] })]);
    expect(categorizer.categorize(at('upstream down'))).toBe('Network');
    expect(categorizer.categorize(at(MESSAGES.network))).toBe('Network');
    expect(categorizer.definitions(new Set(['Network']))).toEqual([{ name: 'Network', color: '#000000', builtIn: true }]);
  });

  it('give a config rule named like a built-in one in replace mode no built-in flag and a palette color', () => {
    const categorizer = withRules([rule({ name: 'Network', match: [/x/] })], { mode: 'replace' });
    expect(categorizer.definitions(new Set(['Network']))).toEqual([{ name: 'Network', color: PALETTE[0], builtIn: false }]);
  });

  it('use palette reference colors for the built-in categories and the neutral one for uncategorized', () => {
    expect(BUILT_IN_RULES.every((r) => r.color !== null && PALETTE.includes(r.color))).toBe(true);
    expect(PALETTE).not.toContain(UNCATEGORIZED_COLOR);
    expect(new Set(PALETTE).size).toBe(PALETTE.length);
  });

  it('never give gold to a built-in category, and give it last to the others', () => {
    const gold = paletteReference('gold');
    expect(BUILT_IN_RULES.map((r) => r.color)).not.toContain(gold);
    expect(PALETTE[PALETTE.length - 1]).toBe(gold);
    // Every built-in category is shown: the first rule without a color takes the one free color, gold.
    const all = new Set([...BUILT_IN_RULES.map((r) => r.name), 'A', 'B']);
    const colors = Object.fromEntries(withRules([rule({ name: 'A' }), rule({ name: 'B' })]).definitions(all).map((d) => [d.name, d.color]));
    expect(colors['A']).toBe(gold);
    // With a free non-gold color, that color goes first.
    const someFree = new Set(['A', 'B', ...BUILT_IN_RULES.slice(1).map((r) => r.name)]);
    const first = withRules([rule({ name: 'A' }), rule({ name: 'B' })]).definitions(someFree);
    expect(first.find((d) => d.name === 'A')?.color).toBe(BUILT_IN_RULES[0]?.color);
    expect(first.find((d) => d.name === 'B')?.color).toBe(gold);
  });

  it('are deterministic: the same config with the same categories present gives the same colors, whatever the run order', () => {
    const config = () => withRules([rule({ name: 'Infra' }), rule({ name: 'Auth', color: paletteReference('teal') }), rule({ name: 'Checkout' })]);
    const names = ['Checkout', 'Timeout', 'Infra', 'Network', 'Uncategorized', 'Auth'];
    const forward = config().definitions(new Set(names));
    const backward = config().definitions(new Set([...names].reverse()));
    expect(backward).toEqual(forward);
    // Colors follow the config rule order: Infra (first rule) takes the first free color, Checkout the next one.
    const colors = Object.fromEntries(forward.map((d) => [d.name, d.color]));
    expect([colors['Infra'], colors['Checkout']]).toEqual([PALETTE[0], PALETTE[3]]);
  });
});

describe('built-in rules', () => {
  it('are, in order, ambiguous locator, locator not found, rate limited, server error, network, assertion and timeout, with distinct colors', () => {
    expect(BUILT_IN_RULES.map((rule) => rule.name)).toEqual([
      'Ambiguous locator',
      'Locator not found',
      'Rate limited',
      'Server error',
      'Network',
      'Assertion',
      'Timeout',
    ]);
    const colors = [...BUILT_IN_RULES.map((builtInRule) => builtInRule.color), UNCATEGORIZED_COLOR];
    expect(new Set(colors).size).toBe(colors.length);
  });
});

describe('definitions', () => {
  it('lists only used categories, in rule order, Uncategorized last', () => {
    const used = new Set(['Uncategorized', 'Timeout', 'Locator not found']);
    expect(builtIn.definitions(used).map((category) => category.name)).toEqual([
      'Locator not found',
      'Timeout',
      'Uncategorized',
    ]);
    expect(builtIn.definitions(used).every((category) => category.builtIn)).toBe(true);
  });

  it('is empty when nothing failed', () => {
    expect(builtIn.definitions(new Set())).toEqual([]);
  });
});
