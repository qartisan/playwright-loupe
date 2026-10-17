import type { ResolvedDimension } from '../config/types.js';
import type { Annotation, DimensionDefinition } from '../schema/v1.js';
import { splitPrefixedTag } from '../shared/tags.js';

/**
 * Dimensions from prefixed tags: `@layer:api` → `{ layer: ['api'] }`.
 * Unprefixed tags produce nothing. Values keep their declaration order and are
 * deduplicated; everything after the first ':' is the value.
 */
export function tagDimensions(tags: readonly string[]): Record<string, string[]> {
  const dimensions: Record<string, string[]> = {};
  for (const tag of tags) {
    const parts = splitPrefixedTag(tag);
    if (!parts) continue;
    const { prefix, value } = parts;
    const values = (dimensions[prefix] ??= []);
    if (!values.includes(value)) values.push(value);
  }
  return dimensions;
}

/** Values of the annotations of one type: their descriptions, deduplicated. Annotations without description give no value. */
export function annotationValues(annotations: readonly Annotation[], type: string): string[] {
  const values: string[] = [];
  for (const annotation of annotations) {
    const value = annotation.description?.trim();
    if (annotation.type === type && value && !values.includes(value)) values.push(value);
  }
  return values;
}

export interface DimensionsOptions {
  /** Keep automatic dimensions from prefixed tags. */
  auto: boolean;
  definitions: readonly ResolvedDimension[];
}

export interface Dimensions {
  /** Dimension name → values for one test. Dimensions without value are absent. */
  of(tags: readonly string[], annotations: readonly Annotation[]): Record<string, string[]>;
  /**
   * Definitions for the report: every configured dimension, in config order,
   * then the automatic dimensions among `used` (dimension names of the
   * tests), sorted by name.
   */
  definitions(used: ReadonlySet<string>): DimensionDefinition[];
}

/**
 * Configured dimensions plus, when `auto` is on, one automatic dimension per
 * tag prefix. A configured tag dimension takes over the automatic dimension of
 * its prefix; an automatic dimension whose name is used by a configured one is
 * dropped, so names stay unique.
 */
export function createDimensions(options: DimensionsOptions): Dimensions {
  const configured = options.definitions;
  const claimedPrefixes = new Set(configured.flatMap((definition) => (definition.from === 'tag' ? [definition.prefix] : [])));
  const configuredNames = new Set(configured.map((definition) => definition.name));
  const isAuto = (prefix: string): boolean =>
    options.auto && !claimedPrefixes.has(prefix) && !configuredNames.has(prefix);

  return {
    of(tags, annotations) {
      const byPrefix = tagDimensions(tags);
      const dimensions: Record<string, string[]> = {};
      for (const definition of configured) {
        const values =
          definition.from === 'tag' ? (byPrefix[definition.prefix] ?? []) : annotationValues(annotations, definition.type);
        if (values.length > 0) dimensions[definition.name] = values;
      }
      for (const [prefix, values] of Object.entries(byPrefix)) {
        if (isAuto(prefix)) dimensions[prefix] = values;
      }
      return dimensions;
    },
    definitions(used) {
      return [
        ...configured.map(
          (definition): DimensionDefinition => ({
            name: definition.name,
            source: definition.from,
            key: definition.from === 'tag' ? definition.prefix : definition.type,
            values: definition.values ? [...definition.values] : null,
          }),
        ),
        ...[...used]
          .filter(isAuto)
          .sort()
          .map((name): DimensionDefinition => ({ name, source: 'tag', key: name, values: null })),
      ];
    },
  };
}

export const DEFAULT_DIMENSIONS: DimensionsOptions = { auto: true, definitions: [] };
