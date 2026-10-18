import type { Attempt, TestCase } from '../../schema/v1.js';
import { isFailingAttempt } from '../dashboard.js';

/**
 * Which attempt the test detail shows. Pure functions, no DOM: unit-tested
 * in Node.
 */

/** `Attempt 1` for the first run, then `Retry 1`, `Retry 2` … */
export function attemptLabel(index: number): string {
  return index === 0 ? 'Attempt 1' : `Retry ${index}`;
}

/**
 * The attempt to show first: the last failing one, which explains the
 * outcome. A failed test shows its last attempt, a flaky test its failing
 * attempt (the passing retry teaches nothing), any other test its last
 * attempt. Null for a test without attempts.
 */
export function defaultAttempt(test: Pick<TestCase, 'attempts' | 'expectedStatus'>): Attempt | null {
  const failing = test.attempts.filter((attempt) => isFailingAttempt(test as TestCase, attempt));
  return failing[failing.length - 1] ?? test.attempts[test.attempts.length - 1] ?? null;
}

/**
 * The attempt for the `attempt` URL parameter: the attempt with that index,
 * else the default one. `valid` is false when the parameter was set but names
 * no attempt, so the URL can be normalized.
 */
export function selectAttempt(
  test: Pick<TestCase, 'attempts' | 'expectedStatus'>,
  requested: number | null,
): { attempt: Attempt | null; valid: boolean } {
  if (requested === null) return { attempt: defaultAttempt(test), valid: true };
  const attempt = test.attempts.find((candidate) => candidate.index === requested);
  return attempt ? { attempt, valid: true } : { attempt: defaultAttempt(test), valid: false };
}
