import type { CategoryDefinition } from '../schema/v1.js';

/**
 * Error categorization rules. Ordered: the first rule whose pattern matches the
 * error message or stack wins; errors matching no rule go to `Uncategorized`.
 *
 * Only the built-in defaults exist for now. This module is the single place
 * that will merge user rules (`extend` / `replace`) once config loading lands.
 */
export interface CategoryRule {
  name: string;
  color: string;
  match: RegExp[];
}

export const UNCATEGORIZED: Readonly<CategoryDefinition> = { name: 'Uncategorized', color: '#6b7280', builtIn: true };

export const BUILT_IN_RULES: readonly CategoryRule[] = [
  {
    // Before "Assertion" and "Timeout": a missing element surfaces as a failed
    // or timed-out expect/action, and "not found" is the useful diagnosis.
    name: 'Locator not found',
    color: '#7c3aed',
    match: [/element\(s\) not found/i, /resolved to 0 elements/i],
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
  },
  {
    // Before "Timeout": a retrying expect that never matched reports its own
    // timeout but is an assertion failure.
    name: 'Assertion',
    color: '#dc2626',
    match: [/\bexpect\(/, /^\s*Expected\b.*:/m, /\bAssertionError\b/],
  },
  {
    name: 'Timeout',
    color: '#d97706',
    match: [/\bTest timeout of \d+ms exceeded/i, /\bTimeout \d+ms exceeded/i, /\btimed out\b/i],
  },
];

/** Returns the category name of an error. Never null: unmatched errors are `Uncategorized`. */
export function categorize(
  error: { message: string; stack: string | null },
  rules: readonly CategoryRule[] = BUILT_IN_RULES,
): string {
  const text = error.stack ? `${error.message}\n${error.stack}` : error.message;
  return rules.find((rule) => rule.match.some((pattern) => pattern.test(text)))?.name ?? UNCATEGORIZED.name;
}

/** Definitions of the categories in `used`, in rule order, `Uncategorized` last. */
export function usedCategories(
  used: ReadonlySet<string>,
  rules: readonly CategoryRule[] = BUILT_IN_RULES,
): CategoryDefinition[] {
  const definitions = rules
    .filter((rule) => used.has(rule.name))
    .map((rule): CategoryDefinition => ({ name: rule.name, color: rule.color, builtIn: true }));
  if (used.has(UNCATEGORIZED.name)) definitions.push({ ...UNCATEGORIZED });
  return definitions;
}
