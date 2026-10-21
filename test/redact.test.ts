import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_REDACT,
  REDACTED,
  createNameMatcher,
  createRedactor,
  DEFAULT_SECRET_NAMES,
  mapReportStrings,
  parseInputStep,
  secretValues,
  words,
  type RedactOptions,
  type StepLike,
} from '../src/core/redact.js';
import { errorSignature } from '../src/core/signature.js';

// Every value below is invented.
const SECRET = 'S3cr3t-"quoted"-value';
const SOURCE = '/project/tests/login.spec.ts';

const step = (title: string, extra: Partial<StepLike> & { subtitle?: string } = {}): StepLike => ({
  title,
  category: 'pw:api',
  location: undefined,
  steps: [],
  ...extra,
});

/** A redactor reading sources from an in-memory map, so no test touches the disk. */
const redactor = (options: Partial<RedactOptions> = {}, sources: Record<string, string> = {}) =>
  createRedactor({ ...DEFAULT_REDACT, readSource: (file) => sources[file] ?? null, ...options });

describe('words', () => {
  it('splits on separators and camelCase boundaries, lowercased', () => {
    expect(words("getByLabel('Password', { exact: true })")).toEqual(['get', 'by', 'label', 'password', 'exact', 'true']);
    expect(words('APIKey x-api-key api_key')).toEqual(['api', 'key', 'x', 'api', 'key', 'api', 'key']);
    expect(words('this.passwordInput.fill(pwd)')).toEqual(['this', 'password', 'input', 'fill', 'pwd']);
  });
});

describe('secret-looking names (defaults)', () => {
  const secret = createNameMatcher(DEFAULT_SECRET_NAMES);

  it.each([
    "getByLabel('Password', { exact: true })",
    "getByLabel('New password')",
    'locator(\'input[type="password"]\')',
    "getByLabel('Passphrase')",
    "locator('#pwd')",
    "getByTestId('otp-input')",
    "getByLabel('PIN code')",
    "getByLabel('API key')",
    'apiKey',
    'x-api-key',
    'client_secret',
    'x-auth-token',
    'authToken',
    'cookie',
    'set-cookie',
    'authorization',
    'proxy-authorization',
    'x-csrf-token',
    'credentials',
    'sessionId',
  ])('matches %s', (text) => {
    expect(secret(text)).toBe(true);
  });

  it.each([
    "getByLabel('Author')",
    "getByLabel('Email', { exact: true })",
    "getByTestId('spinner')",
    "getByLabel('Pinned')",
    "getByText('footprint')",
    "getByLabel('Secretary')",
    "getByTestId('tokenizer')",
    "getByLabel('Title')",
    'content-type',
    'location',
    'user-agent',
  ])('does not match %s', (text) => {
    expect(secret(text)).toBe(false);
  });

  it('matches multi-word strings across separators, and RegExps as is', () => {
    const matcher = createNameMatcher(['mot de passe', /^x-vercel-/]);
    expect(matcher("getByLabel('Mot de passe')")).toBe(true);
    expect(matcher('x-vercel-protection-bypass')).toBe(true);
    expect(matcher("getByLabel('Mot')")).toBe(false);
  });

  it('never matches with no pattern', () => {
    expect(createNameMatcher([])('password')).toBe(false);
  });
});

describe('parseInputStep', () => {
  it.each([
    // Playwright 1.53+ (1.63+ adds the target as subtitle). Quotes are not escaped, newlines are written \n.
    [`Fill "${SECRET}"`, SECRET, `Fill "${REDACTED}"`],
    ['Fill "line-one\\nline-two"', 'line-one\\nline-two', `Fill "${REDACTED}"`],
    ['Fill ""', '', `Fill "${REDACTED}"`],
    ['Type "typed-V4lue"', 'typed-V4lue', `Type "${REDACTED}"`],
    ['Insert "kbd-insert-V4lue"', 'kbd-insert-V4lue', `Insert "${REDACTED}"`],
    // Playwright 1.52.
    [`locator.fill(${SECRET})`, SECRET, `locator.fill(${REDACTED})`],
    ["locator.getByLabel('Password').type(typed-V4lue)", 'typed-V4lue', `locator.getByLabel('Password').type(${REDACTED})`],
    ["locator.getByLabel('Password').pressSequentially(seq-V4lue)", 'seq-V4lue', `locator.getByLabel('Password').pressSequentially(${REDACTED})`],
    ['keyboard.type(kbd-type-V4lue)', 'kbd-type-V4lue', `keyboard.type(${REDACTED})`],
    ['keyboard.insertText(a(b)c)', 'a(b)c', `keyboard.insertText(${REDACTED})`],
  ])('reads %s', (title, value, redacted) => {
    expect(parseInputStep(title)).toMatchObject({ value, redacted });
  });

  it('keeps the 1.52 target, and has none from 1.53', () => {
    expect(parseInputStep("locator.getByLabel('Password').type(x)")?.target).toBe("locator.getByLabel('Password')");
    expect(parseInputStep('Fill "x"')?.target).toBeNull();
  });

  it.each(['Click', 'Press "Enter"', 'Select option', 'elementHandle.fill', "locator.getByLabel('Email').press(Enter)", 'Expect "toHaveValue"', 'Fill form'])(
    'ignores %s',
    (title) => {
      expect(parseInputStep(title)).toBeNull();
    },
  );
});

describe('mechanism A: input steps on secret-looking targets', () => {
  it('uses the subtitle (Playwright 1.63+)', () => {
    const fill = step(`Fill "${SECRET}"`, { subtitle: "getByLabel('Password')" });
    const email = step('Fill "qa.user@example.test"', { subtitle: "getByLabel('Email')" });
    const scope = redactor().attempt([fill, email]);
    expect(scope.title(fill)).toBe(`Fill "${REDACTED}"`);
    expect(scope.title(email)).toBe('Fill "qa.user@example.test"');
  });

  it('uses the target in the title (Playwright 1.52 type and pressSequentially)', () => {
    const type = step("locator.getByLabel('Password').type(typed-V4lue)");
    expect(redactor().attempt([type]).title(type)).toBe(`locator.getByLabel('Password').type(${REDACTED})`);
  });

  it('falls back on the source line of the call, on every version', () => {
    const sources = {
      [SOURCE]: [
        "await page.locator('#field-3').fill(password);",
        'await page.keyboard.type(user.pin);',
        "await page.locator('#field-3').fill(notes);",
        "await page.getByLabel('Password').fill(value);",
      ].join('\n'),
    };
    const at = (line: number) => ({ location: { file: SOURCE, line } });
    const neutralLocator = step('Fill "neutral-Fld-9x7q"', { subtitle: "locator('#field-3')", ...at(1) }); // 1.63+
    const keyboard = step('Type "kbd-type-V4lue"', at(2)); // no target on any version
    const neutral = step('Fill "plain notes"', { subtitle: "locator('#field-3')", ...at(3) });
    const legacyFill = step('locator.fill(legacy-V4lue)', at(4)); // 1.52: no target in a fill title
    const noTarget = step('Fill "range-V4lue"', at(4)); // 1.53–1.62: no subtitle
    const scope = redactor({}, sources).attempt([neutralLocator, keyboard, neutral, legacyFill, noTarget]);
    expect(scope.title(neutralLocator)).toBe(`Fill "${REDACTED}"`);
    expect(scope.title(keyboard)).toBe(`Type "${REDACTED}"`);
    expect(scope.title(neutral)).toBe('Fill "plain notes"');
    expect(scope.title(legacyFill)).toBe(`locator.fill(${REDACTED})`);
    expect(scope.title(noTarget)).toBe(`Fill "${REDACTED}"`);
  });

  it('skips the fallback when the source cannot be read (merge-reports without the code)', () => {
    const fill = step('Fill "range-V4lue"', { location: { file: '/elsewhere/login.spec.ts', line: 4 } });
    expect(redactor().attempt([fill]).title(fill)).toBe('Fill "range-V4lue"');
  });

  it('finds input steps nested in other steps, and only Playwright actions', () => {
    const fill = step(`Fill "${SECRET}"`, { subtitle: "getByLabel('Password')" });
    const userStep = step(`Fill "${SECRET}"`, { category: 'test.step', steps: [fill] });
    const scope = redactor().attempt([userStep]);
    expect(scope.title(fill)).toBe(`Fill "${REDACTED}"`);
    // The user's own step is not an input step, but the typed value is still redacted in it.
    expect(scope.title(userStep)).toBe(`Fill "${REDACTED}"`);
  });

  it('redacts the typed value where Playwright repeats it: call log, assertions, other steps of the attempt', () => {
    const fill = step('Fill "disabled-P4ssword"', { subtitle: "getByLabel('Password')" });
    const message = [
      'TimeoutError: locator.fill: Timeout 1500ms exceeded.',
      'Call log:',
      "  - waiting for getByLabel('Password')",
      '    - fill("disabled-P4ssword")',
      'Expected: "disabled-P4ssword"',
    ].join('\n');
    const text = redactor().attempt([fill]).text(message);
    expect(text).not.toContain('disabled-P4ssword');
    expect(text).toContain(`    - fill("${REDACTED}")`);
    expect(text).toContain("waiting for getByLabel('Password')");
  });

  it('redacts a value with a newline in its real form too', () => {
    const fill = step('Fill "line-one\\nline-two"', { subtitle: "getByLabel('Passphrase')" });
    expect(redactor().attempt([fill]).text('    - fill("line-one\nline-two")')).toBe(`    - fill("${REDACTED}")`);
  });

  it('redacts a short value only in quoted form, so line numbers stay intact', () => {
    const fill = step('Fill "1234"', { subtitle: "getByLabel('PIN')" });
    const scope = redactor().attempt([fill]);
    expect(scope.title(fill)).toBe(`Fill "${REDACTED}"`);
    expect(scope.text('    - fill("1234")\n    at /project/tests/pin.spec.ts:1234:5')).toBe(
      `    - fill("${REDACTED}")\n    at /project/tests/pin.spec.ts:1234:5`,
    );
  });

  it('does not carry a value over to another attempt', () => {
    const fill = step(`Fill "${SECRET}"`, { subtitle: "getByLabel('Password')" });
    redactor().attempt([fill]);
    expect(redactor().attempt([]).text(`fill("${SECRET}")`)).toBe(`fill("${SECRET}")`);
  });

  it('adds configured names in extend mode, uses only them in replace mode, and stops with replace []', () => {
    const code = step('Fill "AB12CD"', { subtitle: "getByLabel('Recovery code')" });
    const password = step(`Fill "${SECRET}"`, { subtitle: "getByLabel('Password')" });
    const extend = redactor({ patterns: ['recovery code'] }).attempt([code, password]);
    expect([extend.title(code), extend.title(password)]).toEqual([`Fill "${REDACTED}"`, `Fill "${REDACTED}"`]);
    const replace = redactor({ mode: 'replace', patterns: [/recovery/i] }).attempt([code, password]);
    expect([replace.title(code), replace.title(password)]).toEqual([`Fill "${REDACTED}"`, `Fill "${SECRET}"`]);
    const off = redactor({ mode: 'replace', patterns: [] }).attempt([code, password]);
    expect([off.title(code), off.title(password)]).toEqual(['Fill "AB12CD"', `Fill "${SECRET}"`]);
    expect(redactor({ mode: 'replace', patterns: [] }).text('    - cookie: session=abc123')).toBe('    - cookie: session=abc123');
  });
});

describe('mechanism C: HTTP header values', () => {
  // Call log of a failing apiRequestContext call, as Playwright prints it (invented values).
  const CALL_LOG = [
    'Error: apiRequestContext.post: Request context disposed.',
    'Call log:',
    '  - → POST http://localhost:3000/api/v1/tickets',
    '    - user-agent: Mozilla/5.0',
    '    - cookie: session-token=abc.def.ghi; csrf=xyz',
    '    - authorization: Bearer eyJhbGciOiJIUzI1NiJ9.invented',
    '    - proxy-authorization: Basic aW52ZW50ZWQ=',
    '    - x-api-key: invented-key-123',
    '    - x-vercel-protection-bypass: invented-bypass',
    '  - ← 302 Found',
    '    - set-cookie: session-token=abc.def.ghi; Path=/; Expires=Fri, 20 Nov 2026 06:34:01 GMT; HttpOnly',
    '    - location: /login?error=CredentialsSignin',
    '    - content-type: text/html',
  ].join('\n');

  it('replaces the values of secret-looking headers, keeping the others', () => {
    expect(redactor().text(CALL_LOG)).toBe(
      [
        'Error: apiRequestContext.post: Request context disposed.',
        'Call log:',
        '  - → POST http://localhost:3000/api/v1/tickets',
        '    - user-agent: Mozilla/5.0',
        `    - cookie: ${REDACTED}`,
        `    - authorization: ${REDACTED}`,
        `    - proxy-authorization: ${REDACTED}`,
        `    - x-api-key: ${REDACTED}`,
        // Not a secret-looking name by default: add it to redact.patterns.
        '    - x-vercel-protection-bypass: invented-bypass',
        '  - ← 302 Found',
        `    - set-cookie: ${REDACTED}`,
        '    - location: /login?error=CredentialsSignin',
        '    - content-type: text/html',
      ].join('\n'),
    );
    expect(redactor({ patterns: ['bypass'] }).text(CALL_LOG)).toContain(`x-vercel-protection-bypass: ${REDACTED}`);
  });

  it('also reads bare header lines, and leaves other lines alone', () => {
    const message = [
      'Error: Request failed',
      'Authorization: Bearer invented',
      'Author: Jane',
      "Locator: getByLabel('Password')",
      'Expected: "Password reset"',
    ].join('\n');
    expect(redactor().text(message)).toBe(
      ['Error: Request failed', `Authorization: ${REDACTED}`, 'Author: Jane', "Locator: getByLabel('Password')", 'Expected: "Password reset"'].join('\n'),
    );
  });

  it('applies to the errors of an attempt too', () => {
    expect(redactor().attempt([]).text('    - cookie: a=b')).toBe(`    - cookie: ${REDACTED}`);
  });
});

describe('mechanism C: URL parameters', () => {
  it.each([
    // Navigation titles: Playwright 1.53–1.62 put the URL in the title, 1.63+ in the subtitle (host, path and query).
    ['Navigate to "http://localhost:3000/reset?token=Inv3nted-tok&lang=en"', `Navigate to "http://localhost:3000/reset?token=${REDACTED}&lang=en"`],
    ['localhost:3000/reset?reset_token=Inv3nted-tok', `localhost:3000/reset?reset_token=${REDACTED}`],
    // Call logs.
    ['  - → GET https://api.example.test/v1/me?page=2&access_token=Inv3nted-tok', `  - → GET https://api.example.test/v1/me?page=2&access_token=${REDACTED}`],
    ['  - navigating to "http://localhost:3000/callback#access_token=Inv3nted-tok&expires_in=3600", waiting until "load"', `  - navigating to "http://localhost:3000/callback#access_token=${REDACTED}&expires_in=3600", waiting until "load"`],
    // Error messages, camelCase and other secret-looking names.
    ['Error: GET /verify?resetToken=Inv3nted-tok failed', `Error: GET /verify?resetToken=${REDACTED} failed`],
    ['Error: (https://x.test/a?api_key=Inv3nted-key) rejected', `Error: (https://x.test/a?api_key=${REDACTED}) rejected`],
    ['https://bucket.test/f?X-Amz-Credential=Inv3nted%2F20261021&X-Amz-Expires=60', `https://bucket.test/f?X-Amz-Credential=${REDACTED}&X-Amz-Expires=60`],
  ])('redacts the value in %j', (text, redacted) => {
    expect(redactor().text(text)).toBe(redacted);
    expect(redactor().attempt([]).text(text)).toBe(redacted);
  });

  it.each([
    'Navigate to "http://localhost:3000/books?author=jane&page=2"',
    'https://x.test/search?q=password&tokenizer=word&spin=1',
    'https://x.test/?utm_campaign=password-reset&sort=pinned',
    'Error: expected token=abc in the payload',
    'https://x.test/reset?token=',
  ])('keeps %j', (text) => {
    expect(redactor().text(text)).toBe(text);
  });

  it('applies to step titles, every other string of the report, and is idempotent', () => {
    const navigate = step('Navigate to "http://localhost:3000/reset?token=Inv3nted-tok"');
    expect(redactor().attempt([navigate]).title(navigate)).toBe(`Navigate to "http://localhost:3000/reset?token=${REDACTED}"`);
    const r = redactor();
    expect(r.rewritesStrings).toBe(true);
    const once = r.strings('stdout: opening https://x.test/r?token=Inv3nted-tok');
    expect(once).toBe(`stdout: opening https://x.test/r?token=${REDACTED}`);
    expect(r.strings(once)).toBe(once);
  });

  it('stops with replace [], and follows configured names', () => {
    const text = 'https://x.test/r?token=Inv3nted-tok&sig=Inv3nted-sig';
    expect(redactor({ mode: 'replace', patterns: [] }).text(text)).toBe(text);
    expect(redactor({ mode: 'replace', patterns: [] }).rewritesStrings).toBe(false);
    expect(redactor({ patterns: ['sig'] }).text(text)).toBe(`https://x.test/r?token=${REDACTED}&sig=${REDACTED}`);
  });
});

describe('mechanism B: values of redact.env variables', () => {
  it('reads the values, warning about unset, empty and short ones by name only', () => {
    const warn = vi.fn();
    const values = secretValues(
      ['API_TOKEN', 'MISSING', 'EMPTY', 'SHORT', 'OTHER'],
      { API_TOKEN: 'tok-Inv3nted-1', EMPTY: '', SHORT: 'abc12', OTHER: 'other-Inv3nted' },
      warn,
    );
    expect(values).toEqual(['tok-Inv3nted-1', 'other-Inv3nted']);
    expect(warn.mock.calls.map(([message]) => message)).toEqual([
      'Loupe: redact.env: MISSING is not set or empty; nothing to redact for it.',
      'Loupe: redact.env: EMPTY is not set or empty; nothing to redact for it.',
      'Loupe: redact.env: the value of SHORT is shorter than 6 characters and is not redacted (too many false matches).',
    ]);
    expect(warn.mock.calls.flat().join(' ')).not.toContain('abc12');
  });

  it('replaces every occurrence of every value, in titles, errors and any other text', () => {
    const r = redactor({ values: ['tok-Inv3nted-1', 'other-Inv3nted'] });
    const fill = step('Fill "tok-Inv3nted-1"', { subtitle: "locator('#notes')" });
    const scope = r.attempt([fill]);
    expect(scope.title(fill)).toBe(`Fill "${REDACTED}"`);
    expect(scope.text('got tok-Inv3nted-1 and other-Inv3nted, twice: tok-Inv3nted-1')).toBe(
      `got ${REDACTED} and ${REDACTED}, twice: ${REDACTED}`,
    );
    expect(r.values('stdout: other-Inv3nted')).toBe(`stdout: ${REDACTED}`);
    expect(r.text('run error with tok-Inv3nted-1')).toBe(`run error with ${REDACTED}`);
  });

  it('leaves no part of overlapping values, longest first, and is idempotent', () => {
    const r = redactor({ values: ['abcdef12', 'cdef1234', 'redacted'] });
    const once = r.values('x abcdef1234 y cdef1234 z');
    expect(once).not.toMatch(/abcdef12|cdef1234/);
    expect(r.values(once)).toBe(once);
    expect(r.values(`a ${REDACTED} b`)).toBe(`a ${REDACTED} b`);
  });

  it('rewrites every string of the report except ids, signatures, snippets and attachment paths', () => {
    const value = 'abcdef1234';
    const report = {
      id: `${value}00`,
      tests: [
        {
          id: value,
          title: `logs in as ${value}`,
          annotations: [{ type: 'note', description: value }],
          errorSignature: value,
          attempts: [
            {
              stdout: { text: `token ${value}\n`, truncated: false },
              errors: [{ message: value, signature: value, snippet: `const x = '${value}';` }],
              attachments: [{ name: value, path: `data/x/0/${value}.txt`, body: `body ${value}` }],
            },
          ],
        },
      ],
    };
    const result = mapReportStrings(report, redactor({ values: [value] }).strings);
    expect(result).toEqual({
      id: `${value}00`,
      tests: [
        {
          id: value,
          title: `logs in as ${REDACTED}`,
          annotations: [{ type: 'note', description: REDACTED }],
          errorSignature: value,
          attempts: [
            {
              stdout: { text: `token ${REDACTED}\n`, truncated: false },
              errors: [{ message: REDACTED, signature: value, snippet: `const x = '${value}';` }],
              attachments: [{ name: REDACTED, path: `data/x/0/${value}.txt`, body: `body ${REDACTED}` }],
            },
          ],
        },
      ],
    });
    expect(report.tests[0]?.title).toBe(`logs in as ${value}`);
  });
});

describe('redaction runs before signatures', () => {
  it('gives the same signature to two errors that differ only by a secret', () => {
    const scopeA = redactor().attempt([step('Fill "first-P4ssword"', { subtitle: "getByLabel('Password')" })]);
    const scopeB = redactor().attempt([step('Fill "second-P4ssword!"', { subtitle: "getByLabel('Password')" })]);
    const failure = (value: string) => `Error: expect(locator).toHaveValue(expected) failed\n\nLocator: getByLabel('Password')\nExpected: "x"\nReceived: "${value}"`;
    const a = scopeA.text(failure('first-P4ssword'));
    const b = scopeB.text(failure('second-P4ssword!'));
    expect(errorSignature(a)).toBe(errorSignature(b));
    expect(errorSignature(failure('first-P4ssword'))).not.toBe(errorSignature(failure('second-P4ssword!')));
    const env = redactor({ values: ['env-Inv3nted-1', 'env-Inv3nted-2'] });
    expect(errorSignature(env.text('Error: rejected key env-Inv3nted-1'))).toBe(errorSignature(env.text('Error: rejected key env-Inv3nted-2')));
  });

  it('redacts the toBeOK() response line it keeps', () => {
    // A server can put anything in its reason phrase: here, an env value echoed back.
    const env = redactor({ values: ['env-Inv3nted-alpha', 'env-Inv3nted-omega'] });
    const failure = (value: string) =>
      `Error: expect(response).toBeOK() failed\n\n\nCall log:\n→ GET http://127.0.0.1:41733/api/orders?apiKey=${value}\n  accept: */*\n← 503 Rejected ${value}\n  content-length: 0\n`;
    const a = env.text(failure('env-Inv3nted-alpha'));
    expect(a).not.toContain('env-Inv3nted-alpha');
    expect(errorSignature(a)).toBe(errorSignature(env.text(failure('env-Inv3nted-omega'))));
    expect(errorSignature(failure('env-Inv3nted-alpha'))).not.toBe(errorSignature(failure('env-Inv3nted-omega')));
  });
});
