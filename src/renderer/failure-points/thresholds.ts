/**
 * Thresholds of the common failure points. Named constants, not config
 * options: the heuristic is still being tuned (see README, "Common failure
 * points"). A point below any of them is not shown anywhere.
 */

/** Distinct tests (a test run in several projects counts once). */
export const MIN_POINT_TESTS = 5;

/** Distinct spec files. */
export const MIN_POINT_FILES = 3;

/** Distinct error groups (signatures). */
export const MIN_POINT_GROUPS = 2;

/** Points shown at most, after folding. */
export const MAX_POINTS = 5;
