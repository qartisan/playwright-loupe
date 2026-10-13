import type { CategoryMode, CategoryTarget, ResolvedCategoryRule } from '../config/types.js';
import type { CategoryDefinition } from '../schema/v1.js';

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
  /** Null: a color is picked from the palette. */
  color: string | null;
  match: RegExp[];
  targets: readonly Target[];
}

const ALL_TARGETS: readonly Target[] = ['message', 'stack', 'step'];

export const UNCATEGORIZED_COLOR = '#6b7280';

export const BUILT_IN_RULES: readonly CategoryRule[] = [
  {
    // Before "Assertion" and "Timeout": a missing element surfaces as a failed
    // or timed-out expect/action, and "not found" is the useful diagnosis.
    name: 'Locator not found',
    color: '#7c3aed',
    match: [/element\(s\) not found/i, /resolved to 0 elements/i],
    targets: ['message', 'stack'],
  },
  {
    // Before "Timeout" so connection timeouts (ETIMEDOUT) count as network.
    name: 'Network',
    color: '#0891b2',
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
    color: '#dc2626',
    match: [/\bexpect\(/, /^\s*Expected\b.*:/m, /\bAssertionError\b/],
    targets: ['message', 'stack'],
  },
  {
    name: 'Timeout',
    color: '#d97706',
    match: [/\bTest timeout of \d+ms exceeded/i, /\bTimeout \d+ms exceeded/i, /\btimed out\b/i],
    targets: ['message', 'stack'],
  },
];

/**
 * Colors for categories without one, assigned in rule order. Distinct from the
 * built-in and uncategorized colors; colors already taken by another category
 * are skipped, and the palette wraps around when exhausted.
 */
export const PALETTE: readonly string[] = [
  '#2563eb',
  '#16a34a',
  '#db2777',
  '#ca8a04',
  '#0d9488',
  '#9333ea',
  '#ea580c',
  '#4f46e5',
  '#65a30d',
  '#be123c',
];

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
  const taken = new Set([...colors.values(), UNCATEGORIZED_COLOR].map((color) => color.toLowerCase()));
  let next = 0;
  for (const name of names) {
    if (colors.has(name)) continue;
    const free = PALETTE.slice(next).concat(PALETTE.slice(0, next)).find((color) => !taken.has(color));
    const color = free ?? (PALETTE[next % PALETTE.length] as string);
    next = (PALETTE.indexOf(color) + 1) % PALETTE.length;
    taken.add(color);
    colors.set(name, color);
  }
  const builtInNames = new Set(builtIns.map((rule) => rule.name));

  return {
    categorize(error) {
      return rules.find((rule) => matches(rule, error))?.name ?? options.uncategorized;
    },
    definitions(used) {
      const definitions = names
        .filter((name) => used.has(name))
        .map((name): CategoryDefinition => ({ name, color: colors.get(name) as string, builtIn: builtInNames.has(name) }));
      if (used.has(options.uncategorized)) {
        definitions.push({ name: options.uncategorized, color: UNCATEGORIZED_COLOR, builtIn: true });
      }
      return definitions;
    },
  };
}

/** Categorizer with the built-in rules only. */
export const DEFAULT_CATEGORIES: CategoriesOptions = { mode: 'extend', rules: [], uncategorized: 'Uncategorized' };
