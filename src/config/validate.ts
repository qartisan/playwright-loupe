import { CATEGORY_MODES, CATEGORY_TARGETS, SCREENSHOT_VIEWS, THEMES } from './types.js';

/**
 * Hand-written validator for one config layer (config file, inline options or
 * environment). It returns every problem found, each naming the source, the
 * exact path and what was expected:
 *
 *   loupe.config.ts: categories.rules[2].match must be a RegExp or an array of RegExp, got "ECONN"
 *
 * An option set to `undefined` counts as absent, so `title: process.env.X`
 * stays valid when X is unset. Unknown keys are errors, with a suggestion when
 * a known key is close.
 */

type Check = (value: unknown, path: string, errors: string[]) => void;

interface Context {
  source: string;
}

const COLOR = /^#[0-9a-fA-F]{6}$/;
/** What a tag prefix cannot contain: `@layer:api` has the prefix `layer`. */
const INVALID_PREFIX = /[@:\s]/;

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'an array';
  if (value instanceof RegExp) return `a RegExp (${String(value)})`;
  if (typeof value === 'string') return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'function') return 'a function';
  return `an ${typeof value}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function join(path: string, key: string): string {
  return path === '' ? key : `${path}.${key}`;
}

/** Optimal string alignment distance: Levenshtein plus adjacent transpositions (`titel` → `title` is 1). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) (d[0] as number[])[j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const row = d[i] as number[];
      const previous = d[i - 1] as number[];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min((previous[j] as number) + 1, (row[j - 1] as number) + 1, (previous[j - 1] as number) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        row[j] = Math.min(row[j] as number, ((d[i - 2] as number[])[j - 2] as number) + 1);
      }
    }
  }
  return (d[a.length] as number[])[b.length] as number;
}

/** The closest known key, when it is close enough to be a typo. */
export function suggestKey(key: string, known: readonly string[]): string | null {
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of known) {
    const distance = candidate.toLowerCase() === key.toLowerCase() ? 0 : editDistance(key, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  const tolerance = key.length <= 3 ? 1 : key.length <= 6 ? 2 : 3;
  return bestDistance <= tolerance ? best : null;
}

function object(fields: Record<string, Check>, ctx: Context): Check {
  return (value, path, errors) => {
    if (!isPlainObject(value)) {
      errors.push(`${ctx.source}: ${path || 'the config'} must be an object, got ${describe(value)}`);
      return;
    }
    const known = Object.keys(fields);
    for (const [key, child] of Object.entries(value)) {
      const check = fields[key];
      if (check) {
        if (child !== undefined) check(child, join(path, key), errors);
        continue;
      }
      const suggestion = suggestKey(key, known);
      const hint = suggestion ? `Did you mean "${suggestion}"?` : `Known options: ${known.join(', ')}.`;
      errors.push(`${ctx.source}: ${join(path, key)} is not a known option. ${hint}`);
    }
  };
}

function fail(ctx: Context, path: string, expected: string, value: unknown, errors: string[]): void {
  errors.push(`${ctx.source}: ${path} must be ${expected}, got ${describe(value)}`);
}

function nonEmptyString(ctx: Context): Check {
  return (value, path, errors) => {
    if (typeof value !== 'string' || value.trim() === '') fail(ctx, path, 'a non-empty string', value, errors);
  };
}

function oneOf(values: readonly string[], ctx: Context): Check {
  return (value, path, errors) => {
    if (typeof value !== 'string' || !values.includes(value)) {
      fail(ctx, path, `one of ${values.map((item) => `"${item}"`).join(', ')}`, value, errors);
    }
  };
}

function boolean(ctx: Context): Check {
  return (value, path, errors) => {
    if (typeof value !== 'boolean') fail(ctx, path, 'a boolean', value, errors);
  };
}

function color(ctx: Context): Check {
  return (value, path, errors) => {
    if (typeof value !== 'string' || !COLOR.test(value)) fail(ctx, path, 'a #rrggbb color', value, errors);
  };
}

function regexps(ctx: Context): Check {
  return (value, path, errors) => {
    const expected = 'a RegExp or an array of RegExp';
    if (value instanceof RegExp) return;
    if (!Array.isArray(value)) return fail(ctx, path, expected, value, errors);
    if (value.length === 0) return fail(ctx, path, `${expected} (not empty)`, value, errors);
    value.forEach((item, index) => {
      if (!(item instanceof RegExp)) fail(ctx, `${path}[${index}]`, 'a RegExp', item, errors);
    });
  };
}

function arrayOf(item: Check, ctx: Context): Check {
  return (value, path, errors) => {
    if (!Array.isArray(value)) return fail(ctx, path, 'an array', value, errors);
    value.forEach((child, index) => item(child, `${path}[${index}]`, errors));
  };
}

function values(ctx: Context): Check {
  return (value, path, errors) => {
    if (!Array.isArray(value)) return fail(ctx, path, 'an array of non-empty strings', value, errors);
    const seen = new Set<string>();
    value.forEach((item, index) => {
      if (typeof item !== 'string' || item.trim() === '') return fail(ctx, `${path}[${index}]`, 'a non-empty string', item, errors);
      if (seen.has(item)) errors.push(`${ctx.source}: ${path}[${index}] repeats the value "${item}"`);
      seen.add(item);
    });
  };
}

function tagPrefix(ctx: Context): Check {
  return (value, path, errors) => {
    if (typeof value !== 'string' || value === '' || INVALID_PREFIX.test(value)) {
      fail(ctx, path, "a tag prefix without '@', ':' or spaces (\"layer\" for @layer:api)", value, errors);
    }
  };
}

function dimension(ctx: Context): Check {
  const tag = object({ name: nonEmptyString(ctx), from: () => {}, prefix: tagPrefix(ctx), values: values(ctx) }, ctx);
  const annotation = object({ name: nonEmptyString(ctx), from: () => {}, type: nonEmptyString(ctx), values: values(ctx) }, ctx);
  return (value, path, errors) => {
    if (!isPlainObject(value)) return fail(ctx, path, 'an object', value, errors);
    const required = value['from'] === 'tag' ? ['name', 'prefix'] : value['from'] === 'annotation' ? ['name', 'type'] : null;
    if (!required) return fail(ctx, `${path}.from`, '"tag" or "annotation"', value['from'], errors);
    for (const key of required) {
      if (value[key] === undefined) errors.push(`${ctx.source}: ${join(path, key)} is required when from is "${String(value['from'])}"`);
    }
    (value['from'] === 'tag' ? tag : annotation)(value, path, errors);
  };
}

function categoryRule(ctx: Context): Check {
  const fields = object(
    { name: nonEmptyString(ctx), match: regexps(ctx), on: oneOf(CATEGORY_TARGETS, ctx), color: color(ctx) },
    ctx,
  );
  return (value, path, errors) => {
    fields(value, path, errors);
    if (!isPlainObject(value)) return;
    for (const key of ['name', 'match']) {
      if (value[key] === undefined) errors.push(`${ctx.source}: ${join(path, key)} is required`);
    }
  };
}

/** Checks across the items of one list: unique dimension names, prefixes and annotation types. */
function checkDimensionList(definitions: unknown, ctx: Context, errors: string[]): void {
  if (!Array.isArray(definitions)) return;
  const seen = new Map<string, number>();
  definitions.forEach((definition: unknown, index) => {
    if (!isPlainObject(definition)) return;
    const keys: Array<[string, unknown]> = [
      ['name', definition['name']],
      [definition['from'] === 'tag' ? 'prefix' : 'type', definition['from'] === 'tag' ? definition['prefix'] : definition['type']],
    ];
    for (const [field, value] of keys) {
      if (typeof value !== 'string') continue;
      const key = `${field === 'name' ? 'name' : `${String(definition['from'])}:${field}`}\0${value}`;
      const first = seen.get(key);
      if (first !== undefined) {
        errors.push(
          `${ctx.source}: dimensions.definitions[${index}].${field} "${value}" is already used by dimensions.definitions[${first}]`,
        );
      } else {
        seen.set(key, index);
      }
    }
  });
}

/**
 * Validates one config layer. `source` names it in messages (`loupe.config.ts`,
 * `reporter options`). `configFile` is only accepted in inline options.
 */
export function validateConfig(value: unknown, source: string, options: { allowConfigFile?: boolean } = {}): string[] {
  const ctx: Context = { source };
  const errors: string[] = [];
  const fields: Record<string, Check> = {
    outputFolder: nonEmptyString(ctx),
    title: nonEmptyString(ctx),
    environment: nonEmptyString(ctx),
    categories: object(
      { mode: oneOf(CATEGORY_MODES, ctx), rules: arrayOf(categoryRule(ctx), ctx), uncategorized: nonEmptyString(ctx) },
      ctx,
    ),
    dimensions: object({ auto: boolean(ctx), definitions: arrayOf(dimension(ctx), ctx) }, ctx),
    screenshots: object({ defaultView: oneOf(SCREENSHOT_VIEWS, ctx) }, ctx),
    theme: oneOf(THEMES, ctx),
  };
  if (options.allowConfigFile) fields['configFile'] = nonEmptyString(ctx);
  object(fields, ctx)(value, '', errors);

  if (isPlainObject(value) && isPlainObject(value['dimensions'])) {
    checkDimensionList(value['dimensions']['definitions'], ctx, errors);
  }
  return errors;
}
