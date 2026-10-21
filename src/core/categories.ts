import type { CategoryMode, CategoryTarget, ResolvedCategoryRule } from '../config/types.js';
import type { CategoryDefinition } from '../schema/v1.js';
import { NEUTRAL_ENTRY, PALETTE_ENTRIES, paletteReference } from '../shared/palette.js';
import { httpStatus } from './http.js';

/**
 * Error categorization. Rules are ordered: the first rule with a pattern
 * matching one of its targets wins; errors matching no rule go to the
 * uncategorized bucket. Config rules run before the built-in ones (`extend`)
 * or replace them (`replace`).
 */

/** Text an error is matched against. `step`: titles of the failing steps, outermost first, one per line. */
export interface ErrorText {
  message: string;
  stack: string | null;
  step: string | null;
}

type Target = Exclude<CategoryTarget, 'all'>;

export interface CategoryRule {
  name: string;
  /** `#rrggbb`. Null: a color is picked from the palette. */
  color: string | null;
  match: RegExp[];
  targets: readonly Target[];
}

const ALL_TARGETS: readonly Target[] = ['message', 'stack', 'step'];

export const UNCATEGORIZED_COLOR = NEUTRAL_ENTRY.reference;

export const BUILT_IN_RULES: readonly CategoryRule[] = [
  {
    // Before "Locator not found", "Assertion" and "Timeout": a locator matching
    // several elements fails strict mode, through an action or an expect.
    name: 'Ambiguous locator',
    color: paletteReference('violet'),
    match: [/\bstrict mode violation\b/i],
    targets: ['message', 'stack'],
  },
  {
    // Before "Assertion" and "Timeout": a missing element surfaces as a failed
    // or timed-out expect/action, and "not found" is the useful diagnosis.
    name: 'Locator not found',
    color: paletteReference('magenta'),
    match: [/element\(s\) not found/i, /resolved to 0 elements/i],
    targets: ['message', 'stack'],
  },
  {
    // Before "Network", "Assertion" and "Timeout": the status is the diagnosis,
    // whether it surfaces through `failOnStatusCode`, `toBeOK()` or a thrown
    // error. A bare 429 is not enough (`429ms`, `Received: 429`): it needs an
    // HTTP context (src/core/http.ts), shared with error signatures.
    name: 'Rate limited',
    color: paletteReference('teal'),
    match: [/\bToo Many Requests\b/i, /\brate[- ]?limit/i, httpStatus('429')],
    targets: ['message', 'stack'],
  },
  {
    name: 'Server error',
    color: paletteReference('orange'),
    // In an HTTP context, reason phrase included: `500 Internal Server Error` (failOnStatusCode).
    match: [httpStatus('5\\d\\d')],
    targets: ['message', 'stack'],
  },
  {
    // Before "Timeout" so connection timeouts (ETIMEDOUT) count as network.
    name: 'Network',
    color: paletteReference('cyan'),
    match: [
      /\bnet::ERR_[A-Z_]+/,
      /\bNS_ERROR_[A-Z_]+/,
      /\b(?:ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH)\b/,
      /socket hang up/i,
      /\bfetch failed\b/i,
    ],
    targets: ['message', 'stack'],
  },
  {
    // Before "Timeout": a retrying expect that never matched reports its own
    // timeout but is an assertion failure.
    name: 'Assertion',
    color: paletteReference('blue'),
    match: [/\bexpect\(/, /^\s*Expected\b.*:/m, /\bAssertionError\b/],
    targets: ['message', 'stack'],
  },
  {
    name: 'Timeout',
    color: paletteReference('brown'),
    match: [/\bTest timeout of \d+ms exceeded/i, /\bTimeout \d+ms exceeded/i, /\btimed out\b/i],
    targets: ['message', 'stack'],
  },
];

/**
 * Colors for categories without one: the reference colors of the palette, in
 * palette order (see `src/shared/palette.ts`).
 */
export const PALETTE: readonly string[] = PALETTE_ENTRIES.map((entry) => entry.reference);

export interface CategoriesOptions {
  mode: CategoryMode;
  rules: readonly ResolvedCategoryRule[];
  uncategorized: string;
}

export interface Categorizer {
  /** Category name of an error. Never null: unmatched errors go to the uncategorized bucket. */
  categorize(error: ErrorText): string;
  /** Definitions of the categories in `used`, in rule order, the uncategorized bucket last. */
  definitions(used: ReadonlySet<string>): CategoryDefinition[];
}

function matches(rule: CategoryRule, error: ErrorText): boolean {
  return rule.targets.some((target) => {
    const text = error[target];
    return text !== null && rule.match.some((pattern) => pattern.test(text));
  });
}

export function createCategorizer(options: CategoriesOptions): Categorizer {
  const builtIns = options.mode === 'extend' ? BUILT_IN_RULES : [];
  const rules: CategoryRule[] = [
    ...options.rules.map((rule) => ({
      name: rule.name,
      color: rule.color,
      match: rule.match,
      targets: rule.on === 'all' ? ALL_TARGETS : [rule.on],
    })),
    ...builtIns,
  ];

  // One definition per name, in order of first appearance. The first explicit
  // color wins (a config rule named like a built-in one may recolor it).
  const names = [...new Set(rules.map((rule) => rule.name))];
  const colors = new Map<string, string>();
  for (const name of names) {
    const color = rules.find((rule) => rule.name === name && rule.color !== null)?.color;
    if (color) colors.set(name, color);
  }
  const builtInNames = new Set(builtIns.map((rule) => rule.name));

  /**
   * Colors of the categories in `used` (names in rule order). Explicit colors
   * (configured or built-in) never change. Each category without one takes,
   * in config rule order, the first palette color that no category of the
   * report uses, in palette order (gold last). Once every color is taken,
   * colors repeat in palette order. The result only depends on the config and
   * on which categories the report contains.
   */
  function assignColors(used: readonly string[]): Map<string, string> {
    const assigned = new Map<string, string>();
    const taken = new Set([UNCATEGORIZED_COLOR]);
    for (const name of used) {
      const color = colors.get(name);
      if (color) {
        assigned.set(name, color);
        taken.add(color.toLowerCase());
      }
    }
    let repeated = 0;
    for (const name of used) {
      if (assigned.has(name)) continue;
      const color = PALETTE.find((candidate) => !taken.has(candidate)) ?? (PALETTE[repeated++ % PALETTE.length] as string);
      taken.add(color);
      assigned.set(name, color);
    }
    return assigned;
  }

  return {
    categorize(error) {
      return rules.find((rule) => matches(rule, error))?.name ?? options.uncategorized;
    },
    definitions(used) {
      const usedNames = names.filter((name) => used.has(name));
      const assigned = assignColors(usedNames);
      const definitions = usedNames.map(
        (name): CategoryDefinition => ({ name, color: assigned.get(name) as string, builtIn: builtInNames.has(name) }),
      );
      if (used.has(options.uncategorized)) {
        definitions.push({ name: options.uncategorized, color: UNCATEGORIZED_COLOR, builtIn: true });
      }
      return definitions;
    },
  };
}

/** Categorizer with the built-in rules only. */
export const DEFAULT_CATEGORIES: CategoriesOptions = { mode: 'extend', rules: [], uncategorized: 'Uncategorized' };
