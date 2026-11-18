/**
 * The one way the history cuts a text (error extracts, exclusion reasons, notes), so the cuts cannot drift.
 * A cut never ends on half of a surrogate pair: an emoji or another astral character running across it is
 * dropped whole. Masking always runs before: mask, then cut.
 */

/** The first `length` UTF-16 units of `text` at most, one fewer when the last would be half of a surrogate pair. */
export function prefix(text: string, length: number): string {
  if (text.length <= length) return text;
  const last = text.charCodeAt(length - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? length - 1 : length);
}

/** `text` cut to `max` characters at most, ending with `…` when cut. */
export function cutText(text: string, max: number): string {
  return text.length <= max ? text : `${prefix(text, max - 1)}…`;
}
