import { createHash } from 'node:crypto';

// Same pattern as the `ansi-regex` package (CSI and OSC sequences).
const ANSI_PATTERN =
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*|[a-zA-Z\d]+(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~]))/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

/** Playwright appends the action log after a line starting with "Call log:". */
const CALL_LOG = /^[ \t]*Call log:/m;

/**
 * Ordered replacements. The order matters: URLs before paths (a URL contains
 * slashes), paths before hex and numbers (so a path is replaced as a whole),
 * hex before numbers. See "Error signature" in docs/schema/v1.md.
 */
const REPLACEMENTS: ReadonlyArray<[RegExp, string]> = [
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>'],
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"`<>()[\]{}]*[^\s'"`<>()[\]{}.,;:!?]/gi, '<url>'],
  // ISO 8601 date with optional time and zone.
  [/\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?(?![\w:])/g, '<date>'],
  // Time of day.
  [/\b\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?\b/g, '<date>'],
  // Unix timestamps in seconds or milliseconds (2001–2033).
  [/\b1\d{9}(?:\d{3})?\b/g, '<date>'],
  // Absolute POSIX paths with at least two segments, and Windows drive paths.
  [/(?<![\w.~:/\\-])\/(?:[\w.@+~-]+\/)+[\w.@+~-]+\/?/g, '<path>'],
  [/\b[A-Za-z]:[\\/](?:[^\\/\s'"`:*?<>|]+[\\/])*[^\\/\s'"`:*?<>|]+/g, '<path>'],
  [/\b\d+(?:\.\d+)?\s?(?:ms|milliseconds?|s|secs?|seconds?|m|mins?|minutes?|h|hours?)\b/gi, '<duration>'],
  // 8+ hex chars with at least one letter (pure digit runs fall through to <n>).
  [/(?<![0-9A-Za-z])(?=[0-9a-f]*[a-f])[0-9a-f]{8,}(?![0-9A-Za-z])/gi, '<hex>'],
  [/\d+(?:\.\d+)?/g, '<n>'],
];

/**
 * Normalizes an error message so the same failure produces the same text
 * across tests and runs: ANSI codes and the call log are removed, volatile
 * values are replaced with placeholders and whitespace is collapsed.
 */
export function normalizeErrorMessage(message: string): string {
  let text = stripAnsi(message);
  const callLog = CALL_LOG.exec(text);
  if (callLog) text = text.slice(0, callLog.index);
  for (const [pattern, placeholder] of REPLACEMENTS) {
    text = text.replace(pattern, placeholder);
  }
  return text.replace(/\s+/g, ' ').trim();
}

/** First 12 hex chars of sha256 of the normalized message. Independent of the test. */
export function errorSignature(message: string): string {
  return createHash('sha256').update(normalizeErrorMessage(message)).digest('hex').slice(0, 12);
}
