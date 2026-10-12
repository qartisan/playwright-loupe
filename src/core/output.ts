import type { Output } from '../schema/v1.js';
import { stripAnsi } from './signature.js';

/** Maximum stdout or stderr kept per attempt, in UTF-16 code units, after ANSI stripping. */
export const OUTPUT_LIMIT = 32 * 1024;

/** Joins the output chunks of an attempt, strips ANSI codes and keeps the first OUTPUT_LIMIT characters. */
export function collectOutput(chunks: ReadonlyArray<string | Buffer>, limit = OUTPUT_LIMIT): Output {
  const text = stripAnsi(chunks.map((chunk) => (typeof chunk === 'string' ? chunk : chunk.toString('utf8'))).join(''));
  if (text.length <= limit) return { text, truncated: false };
  let end = limit;
  // Do not cut a surrogate pair in half.
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return { text: text.slice(0, end), truncated: true };
}
