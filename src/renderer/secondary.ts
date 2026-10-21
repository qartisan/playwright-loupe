import type { Attempt } from '../schema/v1.js';

/**
 * Secondary errors: when Playwright's test timeout stops a test, the action
 * still pending fails too (`Request context disposed`, `Target page, context
 * or browser has been closed`, `locator.click: Test timeout of …`) and is
 * reported as a further error of the same attempt. Such an error is
 * secondary; an error group whose every occurrence is secondary is folded in
 * the Errors view (see `ErrorGroup.afterTimeout`). The rule is structural: no
 * list of follow-on messages.
 *
 * Pure functions, no DOM: unit-tested in Node.
 */

/**
 * The messages of Playwright's timeout manager that stop a running test, on
 * their first line, ANSI codes already stripped. The same wording from
 * Playwright 1.52 to the latest version. Worker teardown timeouts (run
 * errors, not test errors) and modifier timeouts are left out.
 */
export const TEST_TIMEOUT_MESSAGES: readonly RegExp[] = [
  // The test body.
  /^Test timeout of \d+ms exceeded\.$/,
  // A fixture being set up within the test timeout.
  /^Test timeout of \d+ms exceeded while setting up "[^"]*"\.$/,
  // A fixture being torn down.
  /^Tearing down "[^"]*" exceeded the test timeout of \d+ms\.$/,
  // A beforeEach or afterEach hook.
  /^Test timeout of \d+ms exceeded while running "(?:beforeEach|afterEach)" hook\.$/,
  // A fixture with its own `timeout` option.
  /^Fixture "[^"]*" timeout of \d+ms exceeded during (?:setup|teardown)\.$/,
  // A beforeAll or afterAll hook.
  /^"(?:beforeAll|afterAll)" hook timeout of \d+ms exceeded\.$/,
];

/** Whether an error message is one of Playwright's test timeout messages. */
export function isTestTimeout(message: string): boolean {
  const first = message.split('\n').find((line) => line.trim() !== '')?.trim() ?? '';
  return TEST_TIMEOUT_MESSAGES.some((pattern) => pattern.test(first));
}

/** An error that is not the first of its attempt, in an attempt whose first error is the test timeout. */
export function isSecondaryError(attempt: Pick<Attempt, 'errors'>, index: number): boolean {
  const first = attempt.errors[0];
  return index > 0 && first !== undefined && isTestTimeout(first.message);
}

/** Shown next to a secondary error in the test detail. */
export const SECONDARY_LABEL = 'Raised after the test timeout';

/** The mention of the folded groups next to a group count: `18 more only seen after a test timeout`. */
export function foldedMention(folded: number): string {
  return `${folded} more only seen after a test timeout`;
}

/** Group counts with the folded groups mentioned: `22 error groups · 18 more only seen after a test timeout`. */
export function groupCountText(visible: number, folded: number): string {
  const text = `${visible} ${visible === 1 ? 'error group' : 'error groups'}`;
  return folded > 0 ? `${text} · ${foldedMention(folded)}` : text;
}

/** The summary of the disclosure holding the folded groups: `18 groups only seen after a test timeout`. */
export function foldedGroupsText(folded: number): string {
  return `${folded} ${folded === 1 ? 'group' : 'groups'} only seen after a test timeout`;
}
