/**
 * Highlighting of error messages and code snippets. The report keeps them
 * without ANSI codes (docs/schema/v1.md, LoupeError), so Playwright's colors
 * are rebuilt from the text, for the patterns Playwright actually prints:
 *
 * - label lines at the start of a line: `Expected: "Wrong heading"`,
 *   `Received: "Loupe fixture"`, `Expected substring: "xyz"`,
 *   `Received string:    "abc"`, `Expected pattern: /xyz/`,
 *   `Expected value: 2`, `Received array: ["a"]`, `Expected length: 3`,
 *   `Received length: 2`, `Expected path: "a"`, `Received value: 1`: the
 *   value after the label is colored, the label is not;
 * - diff blocks opened by the `- Expected  - 1` / `+ Received  + 1` header:
 *   inside the block only, `- ` lines are expected and `+ ` lines received.
 *   The block ends at the first blank line or line of another shape, so a
 *   call log (`  - waiting for …`) is never colored;
 * - in snippets, the arrow line (`> 38 | …`) and the caret line (`|   ^`).
 *
 * Anything else stays plain text. Playwright's character-level highlighting
 * inside strings (inverse video on the differing part) is not reproduced.
 * The output is text spans, rendered as text nodes: no HTML from the message
 * is ever injected.
 *
 * Pure functions, no DOM: unit-tested in Node.
 */

export type Tone = 'expected' | 'received' | 'marker' | 'strong';

export interface Span {
  text: string;
  tone: Tone | null;
}

export type HighlightedLine = Span[];

/** `Expected:`, `Received string:`, `Expected substring:` … at the start of a line, then the value. */
const LABEL_LINE = /^((Expected|Received)(?: [a-z]+)*:)(\s+)(\S.*)$/;
/** Diff header, first line: `- Expected  - 2`. */
const DIFF_EXPECTED_HEADER = /^- Expected(?:\s+- \d+)?$/;
/** Diff header, second line: `+ Received  + 2`. */
const DIFF_RECEIVED_HEADER = /^\+ Received(?:\s+\+ \d+)?$/;
/** A diff body line: `- ` expected, `+ ` received, `  ` common. */
const DIFF_LINE = /^[-+ ] /;

function plain(text: string): HighlightedLine {
  return [{ text, tone: null }];
}

function labelLine(line: string): HighlightedLine | null {
  const match = LABEL_LINE.exec(line);
  if (!match) return null;
  const [, label = '', word, space = '', value = ''] = match;
  return [
    { text: `${label}${space}`, tone: null },
    { text: value, tone: word === 'Expected' ? 'expected' : 'received' },
  ];
}

function diffLine(line: string): HighlightedLine {
  if (line.startsWith('- ')) return [{ text: line, tone: 'expected' }];
  if (line.startsWith('+ ')) return [{ text: line, tone: 'received' }];
  return plain(line);
}

/** Highlights an error message, line by line. */
export function highlightMessage(message: string): HighlightedLine[] {
  const lines = message.split('\n');
  const result: HighlightedLine[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] as string;
    const next = lines[index + 1];
    if (DIFF_EXPECTED_HEADER.test(line) && next !== undefined && DIFF_RECEIVED_HEADER.test(next)) {
      result.push([{ text: line, tone: 'expected' }], [{ text: next, tone: 'received' }]);
      index += 2;
      // Blank lines between the header and the body.
      while (index < lines.length && lines[index] === '') result.push(plain(lines[index++] as string));
      while (index < lines.length && DIFF_LINE.test(lines[index] as string)) result.push(diffLine(lines[index++] as string));
      continue;
    }
    result.push(labelLine(line) ?? plain(line));
    index += 1;
  }
  return result;
}

/** The line the error points at: `> 38 | …`, or `>  7 | …` when line numbers are wider. */
const ARROW_LINE = /^(>)(\s*\d+ \|.*)$/;
/** The caret under it: `     |     ^`. */
const CARET_LINE = /^(\s*\|\s*)(\^+)(\s*)$/;

/** Highlights a code snippet: the arrow line and its caret. */
export function highlightSnippet(snippet: string): HighlightedLine[] {
  return snippet.split('\n').map((line) => {
    const arrow = ARROW_LINE.exec(line);
    if (arrow) return [{ text: arrow[1] as string, tone: 'marker' }, { text: arrow[2] as string, tone: 'strong' }];
    const caret = CARET_LINE.exec(line);
    if (caret) {
      return [
        { text: caret[1] as string, tone: null },
        { text: caret[2] as string, tone: 'marker' },
        ...(caret[3] ? [{ text: caret[3], tone: null }] : []),
      ];
    }
    return plain(line);
  });
}
