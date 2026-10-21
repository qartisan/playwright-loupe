/**
 * HTTP status codes in context, shared by the "Rate limited" and "Server
 * error" categories and by error signatures, so both agree on what an HTTP
 * status is. See "Error categories" and "Error signature" in docs/schema/v1.md.
 *
 * A code is in an HTTP context when it is:
 * - preceded by `status`, `status code`, `statusCode`, `"status":`, `HTTP`,
 *   `HTTP/1.1`, `error`, or `←` (the response line of Playwright's fetch log),
 *   with an optional `:` or `=`: `status 429`, `Response status: 503`,
 *   `HTTP 500`, `statusCode=502`, `with error 401`;
 * - or followed by its reason phrase: `401 Unauthorized`, `500 Internal Server Error`.
 *
 * A bare number is not enough: `Timeout 429ms exceeded` and `Expected: 200
 * Received: 500` have no HTTP context.
 */

const PREFIX = `(?:\\b(?:status(?:[ _]?code)?["']?\\s*[:=]?|HTTP(?:/\\d(?:\\.\\d)?)?:?|error\\s*[:=]?)|←)`;

/** Standard reason phrases (RFC 9110, plus 429). */
const REASON_PHRASES = [
  'Continue',
  'Switching Protocols',
  'OK',
  'Created',
  'Accepted',
  'No Content',
  'Moved Permanently',
  'Found',
  'See Other',
  'Not Modified',
  'Temporary Redirect',
  'Permanent Redirect',
  'Bad Request',
  'Unauthorized',
  'Payment Required',
  'Forbidden',
  'Not Found',
  'Method Not Allowed',
  'Not Acceptable',
  'Request Time-?out',
  'Conflict',
  'Gone',
  'Precondition Failed',
  'Payload Too Large',
  'Content Too Large',
  'Unsupported Media Type',
  'Unprocessable Entity',
  'Unprocessable Content',
  'Too Many Requests',
  'Internal Server Error',
  'Not Implemented',
  'Bad Gateway',
  'Service Unavailable',
  'Gateway Time-?out',
  'HTTP Version Not Supported',
];

/** Any status code from 100 to 599. */
export const STATUS_CODE = '[1-5]\\d\\d';

/** Source of a pattern matching `code` (a regex source such as `429` or `5\\d\\d`) in an HTTP context, case-insensitive. */
export function httpStatusSource(code: string): string {
  return `${PREFIX}\\s*${code}(?!\\w|\\.\\d)|\\b${code} (?:${REASON_PHRASES.join('|')})\\b`;
}

/** `code` in an HTTP context. */
export function httpStatus(code: string): RegExp {
  return new RegExp(httpStatusSource(code), 'i');
}
