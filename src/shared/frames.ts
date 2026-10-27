/**
 * Stack frame lines, shared by the reporter (path rewriting,
 * src/core/paths.ts) and the renderer (failure points, AI prompt): V8's
 * `    at fn (path:line:col)` and `    at path:line:col`, with or without a
 * function name. Every other line of a stack is its message head, or text
 * after the frames (a nested cause).
 */

const FRAME_LINE = /^\s+at (.+)$/;

export function isFrameLine(line: string): boolean {
  return FRAME_LINE.test(line);
}

/** What follows `at ` in a frame line (`async ` included); null for any other line. */
export function frameBody(line: string): string | null {
  return FRAME_LINE.exec(line)?.[1] ?? null;
}
