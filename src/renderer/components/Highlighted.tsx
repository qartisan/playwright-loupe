import { Fragment } from 'preact';
import type { HighlightedLine } from '../detail/highlight.js';

/** Highlighted lines as text nodes, for a `<pre>`. Tones map to theme colors in the stylesheet. */
export function Highlighted({ lines }: { lines: readonly HighlightedLine[] }) {
  return (
    <>
      {lines.map((line, index) => (
        <Fragment key={index}>
          {index > 0 && '\n'}
          {line.map((span, position) =>
            span.tone ? (
              <span key={position} class={`tone-${span.tone}`}>
                {span.text}
              </span>
            ) : (
              span.text
            ),
          )}
        </Fragment>
      ))}
    </>
  );
}
