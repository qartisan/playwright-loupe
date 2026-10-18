import { describe, expect, it } from 'vitest';
import { highlightMessage, highlightSnippet, type HighlightedLine, type Tone } from '../src/renderer/detail/highlight.js';

/**
 * Messages as the report stores them (ANSI codes stripped), taken from real
 * Playwright runs (the fixture suite, a consumer suite, Playwright 1.64) with
 * names, hosts and paths anonymized.
 */

/** Each line as `tone:text` spans, `|` between spans; plain text has no prefix. */
function render(lines: readonly HighlightedLine[]): string[] {
  return lines.map((line) => line.map(({ text, tone }) => (tone ? `${tone}:${text}` : text)).join('|'));
}

/** The lines with a given tone, as text. */
function toned(lines: readonly HighlightedLine[], tone: Tone): string[] {
  return lines.flatMap((line) => line.filter((span) => span.tone === tone).map((span) => span.text));
}

const TO_HAVE_TEXT_WITH_CALL_LOG = `Error: expect(locator).toHaveText(expected) failed

Locator:  getByRole('heading', { level: 1 })
Expected: "Wrong heading"
Received: "Example heading"
Timeout:  500ms

Call log:
  - Expect "toHaveText" getByRole('heading', { level: 1 }) with timeout 500ms
  - waiting for getByRole('heading', { level: 1 })
    6 × locator resolved to <h1>Example heading</h1>
      - unexpected value "Example heading"
`;

const TO_EQUAL_DIFF = `Error: expect(received).toEqual(expected) // deep equality

- Expected  - 2
+ Received  + 2

  Object {
    "id": 7,
    "items": Array [
      "book",
-     "lamp",
+     "pen",
    ],
-   "status": "paid",
+   "status": "pending",
  }`;

const TO_HAVE_TEXT_ARRAY_DIFF_WITH_CALL_LOG = `Error: expect(locator).toHaveText(expected) failed

Locator: locator('li')
Timeout: 200ms
- Expected  - 1
+ Received  + 1

  Array [
    "a",
-   "c",
+   "b",
  ]

Call log:
  - Expect "toHaveText" locator('li') with timeout 200ms
  - waiting for locator('li')
    9 × locator resolved to 2 elements
`;

const FETCH_CALL_LOG = `Error: apiRequestContext.get: 500 Internal Server Error
Response text:
Intentional failure
Call log:
  - → GET http://127.0.0.1:46005/api/orders
    - accept: */*
  - ← 500 Internal Server Error
    - content-length: 19
`;

describe('highlightMessage', () => {
  it('colors the values of Expected / Received lines, not the labels, and leaves the call log plain', () => {
    const lines = highlightMessage(TO_HAVE_TEXT_WITH_CALL_LOG);
    expect(render(lines)).toEqual([
      'Error: expect(locator).toHaveText(expected) failed',
      '',
      "Locator:  getByRole('heading', { level: 1 })",
      'Expected: |expected:"Wrong heading"',
      'Received: |received:"Example heading"',
      'Timeout:  500ms',
      '',
      'Call log:',
      `  - Expect "toHaveText" getByRole('heading', { level: 1 }) with timeout 500ms`,
      "  - waiting for getByRole('heading', { level: 1 })",
      '    6 × locator resolved to <h1>Example heading</h1>',
      '      - unexpected value "Example heading"',
      '',
    ]);
  });

  it.each([
    ['Expected substring: "xyz"', 'Expected substring: ', 'expected', '"xyz"'],
    ['Received string:    "hello world"', 'Received string:    ', 'received', '"hello world"'],
    ['Expected pattern: /xyz/', 'Expected pattern: ', 'expected', '/xyz/'],
    ['Received string:  "about:blank"', 'Received string:  ', 'received', '"about:blank"'],
    ['Expected value: "xyz"', 'Expected value: ', 'expected', '"xyz"'],
    ['Received array: ["a", "b"]', 'Received array: ', 'received', '["a", "b"]'],
    ['Expected length: 3', 'Expected length: ', 'expected', '3'],
    ['Received length: 2', 'Received length: ', 'received', '2'],
    ['Received array:  [1, 2]', 'Received array:  ', 'received', '[1, 2]'],
    ['Expected path: "a"', 'Expected path: ', 'expected', '"a"'],
    ['Received value: 1', 'Received value: ', 'received', '1'],
    ['Expected: not 2', 'Expected: ', 'expected', 'not 2'],
    ['Expected: > 0', 'Expected: ', 'expected', '> 0'],
    ['Received:   0', 'Received:   ', 'received', '0'],
    ['Expected: visible', 'Expected: ', 'expected', 'visible'],
  ])('recognizes the label line %j', (line, label, tone, value) => {
    expect(highlightMessage(line)).toEqual([[{ text: label, tone: null }, { text: value, tone }]]);
  });

  it('colors -/+ lines inside a diff block, keeps common lines plain', () => {
    const lines = highlightMessage(TO_EQUAL_DIFF);
    expect(toned(lines, 'expected')).toEqual(['- Expected  - 2', '-     "lamp",', '-   "status": "paid",']);
    expect(toned(lines, 'received')).toEqual(['+ Received  + 2', '+     "pen",', '+   "status": "pending",']);
    expect(render(lines)).toContain('  Object {');
    expect(render(lines)).toContain('      "book",');
  });

  it('ends the diff block at the blank line before the call log: call log lines are never colored', () => {
    const lines = highlightMessage(TO_HAVE_TEXT_ARRAY_DIFF_WITH_CALL_LOG);
    expect(toned(lines, 'expected')).toEqual(['- Expected  - 1', '-   "c",']);
    expect(toned(lines, 'received')).toEqual(['+ Received  + 1', '+   "b",']);
    const callLog = render(lines).slice(render(lines).indexOf('Call log:'));
    expect(callLog).toEqual([
      'Call log:',
      `  - Expect "toHaveText" locator('li') with timeout 200ms`,
      "  - waiting for locator('li')",
      '    9 × locator resolved to 2 elements',
      '',
    ]);
  });

  it('colors nothing in a call log without a diff header, even lines starting with "- "', () => {
    const lines = highlightMessage(FETCH_CALL_LOG);
    expect(lines.every((line) => line.every((span) => span.tone === null))).toBe(true);
    expect(render(lines).join('\n')).toBe(FETCH_CALL_LOG);
  });

  it('needs both header lines to open a diff block', () => {
    const lines = highlightMessage('Something failed\n- Expected  - 1\n- not a diff line\n+ nor this one');
    expect(lines.every((line) => line.every((span) => span.tone === null))).toBe(true);
  });

  it('leaves unrecognized messages plain, and indented or mid-line labels alone', () => {
    for (const message of [
      'Test timeout of 1000ms exceeded.',
      'Error: Timeout (5000ms) waiting for a webhook request matching the predicate. Received 5 request(s) so far.',
      '  Expected: "indented"',
      'Error: Expected: "mid-line"',
      'Expected:"no space"',
    ]) {
      expect(render(highlightMessage(message))).toEqual(message.split('\n'));
    }
  });

  it('keeps markup as text: spans carry the text verbatim, nothing is interpreted', () => {
    const message = 'Expected: "<img src=x onerror=alert(1)>"\nReceived: "</pre><script>alert(1)</script>"';
    const lines = highlightMessage(message);
    expect(render(lines)).toEqual([
      'Expected: |expected:"<img src=x onerror=alert(1)>"',
      'Received: |received:"</pre><script>alert(1)</script>"',
    ]);
    expect(lines.flatMap((line) => line.map((span) => span.text)).join('').length).toBe(message.length - 1);
  });

  it('loses no character: the spans join back into the message', () => {
    for (const message of [TO_HAVE_TEXT_WITH_CALL_LOG, TO_EQUAL_DIFF, TO_HAVE_TEXT_ARRAY_DIFF_WITH_CALL_LOG, FETCH_CALL_LOG]) {
      expect(highlightMessage(message).map((line) => line.map((span) => span.text).join('')).join('\n')).toBe(message);
    }
  });
});

describe('highlightSnippet', () => {
  it('marks the arrow line and the caret', () => {
    const snippet = [
      "  36 |     { tag: '@layer:ui' },",
      '  37 |     async ({ page }) => {',
      "> 38 |       await expect(page.getByRole('heading')).toHaveText('Wrong heading');",
      '     |                                               ^',
      '  39 |     },',
    ].join('\n');
    expect(render(highlightSnippet(snippet))).toEqual([
      "  36 |     { tag: '@layer:ui' },",
      '  37 |     async ({ page }) => {',
      "marker:>|strong: 38 |       await expect(page.getByRole('heading')).toHaveText('Wrong heading');",
      '     |                                               |marker:^',
      '  39 |     },',
    ]);
  });

  it('handles wider line numbers', () => {
    const snippet = ">  7 | test('toMatch', () => {});\n     |                ^";
    expect(render(highlightSnippet(snippet))).toEqual(["marker:>|strong:  7 | test('toMatch', () => {});", '     |                |marker:^']);
  });

  it('leaves code lines containing > or ^ plain', () => {
    const snippet = '  12 |     expect(a > b).toBe(true); // x ^ y';
    expect(render(highlightSnippet(snippet))).toEqual([snippet]);
  });
});
