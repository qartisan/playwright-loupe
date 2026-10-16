import { categoryStyle } from '../categoryColors.js';

/** A category name in its colors. The name is always written out: color is never the only cue. */
export function CategoryBadge({ name, color }: { name: string; color: string | undefined }) {
  return (
    <span class="category-badge" style={categoryStyle(color)} title={`Category: ${name}`}>
      {name}
    </span>
  );
}
