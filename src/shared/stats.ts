import type { Stats } from '../schema/v1.js';

/**
 * The pass rate, one definition everywhere (verdict, projects, the run-level
 * delta of the history): passed / (total − skipped). Skipped tests are left
 * out; flaky tests do not count as passed. Null when no test ran.
 *
 * Pure, no DOM: shared by the renderer and, later, the core.
 */
export function passRate(stats: Pick<Stats, 'total' | 'passed' | 'skipped'>): number | null {
  const ran = stats.total - stats.skipped;
  return ran > 0 ? stats.passed / ran : null;
}
