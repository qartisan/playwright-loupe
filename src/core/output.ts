import type { LoupeReport, Output } from '../schema/v1.js';
import { stripAnsi } from './signature.js';

/** Maximum stdout or stderr kept per attempt, in UTF-16 code units, after ANSI stripping and masking. */
export const OUTPUT_LIMIT = 32 * 1024;

/**
 * Joins the output chunks of an attempt and strips ANSI codes. The text is
 * whole: `maskOutput` masks it, then cuts it. Cut first, a secret or a home
 * directory running across the cut would only be partly there when masking
 * ran, and would no longer match.
 */
export function collectOutput(chunks: ReadonlyArray<string | Buffer>): Output {
  return { text: stripAnsi(chunks.map((chunk) => (typeof chunk === 'string' ? chunk : chunk.toString('utf8'))).join('')), truncated: false };
}

/** The first `limit` characters of a masked output, never splitting a surrogate pair. */
export function limitOutput(text: string, limit = OUTPUT_LIMIT): Output {
  if (text.length <= limit) return { text, truncated: false };
  let end = limit;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return { text: text.slice(0, end), truncated: true };
}

/** The output of an attempt until `maskOutput` fills it in. */
export const EMPTY_OUTPUT: Output = Object.freeze({ text: '', truncated: false });

/**
 * An attempt's output as the report keeps it: joined, masked with the
 * functions of the report's last pass (URL parameters and env values, then
 * the paths), then cut to `limit`. Masked whole, so a secret or a home
 * running across the cut is masked as if there were none; cut at once, so
 * the report holds one whole output at a time, never all of them.
 */
export function maskOutput(
  chunks: ReadonlyArray<string | Buffer>,
  redactor: { strings(text: string): string },
  paths: { text(text: string): string },
  limit = OUTPUT_LIMIT,
): Output {
  return limitOutput(paths.text(redactor.strings(collectOutput(chunks).text)), limit);
}

/** `output` cut to `limit` again; `truncated` stays true when it was cut already. */
function relimit(output: Output, limit: number): Output {
  const cut = limitOutput(output.text, limit);
  return { text: cut.text, truncated: output.truncated || cut.truncated };
}

/**
 * Cuts the stdout and stderr of every attempt to `limit`, keeping the cut
 * `maskOutput` made. Applied to the masked report, last: what is kept is the
 * start of the masked output, as safe as an output under the limit, whatever
 * masking did to its length.
 */
export function limitOutputs(report: LoupeReport, limit = OUTPUT_LIMIT): LoupeReport {
  return {
    ...report,
    tests: report.tests.map((test) => ({
      ...test,
      attempts: test.attempts.map((attempt) => ({ ...attempt, stdout: relimit(attempt.stdout, limit), stderr: relimit(attempt.stderr, limit) })),
    })),
  };
}
