import type { Annotation, TestCase } from '../schema/v1.js';

/**
 * Why a test was skipped, from the annotations Playwright records (no model
 * change). Every skip API (`test.skip`, `test.fixme`, `testInfo.skip`, in a
 * test, a `describe` or a hook) leaves a `skip` or `fixme` annotation, with
 * the reason as its description when one was given. A skipped test without
 * one was not run: Playwright skipped it because a dependency project or an
 * earlier test of its serial group failed, `--max-failures` was reached, or
 * the run was stopped. The model does not say which, so no cause is asserted.
 *
 * Pure functions, no DOM: unit-tested in Node.
 */

export type SkipKind = 'skip' | 'fixme' | 'notRun';

export interface SkipReason {
  kind: SkipKind;
  /** The annotation's description, trimmed; null when absent or blank, always null for `notRun`. */
  text: string | null;
}

export const NOT_RUN_EXPLANATION =
  'Playwright skipped this test without a skip annotation, usually because a dependency project or an earlier test of its serial group failed, the failure limit (--max-failures) was reached, or the run was stopped.';

function isSkipAnnotation(annotation: Annotation): annotation is Annotation & { type: 'skip' | 'fixme' } {
  return annotation.type === 'skip' || annotation.type === 'fixme';
}

/**
 * The skip reason of a skipped test; null for any other outcome. Annotations
 * of the last attempt first, then of the test; the first skip annotation with
 * a description, else the first skip annotation.
 */
export function skipReason(test: Pick<TestCase, 'outcome' | 'annotations' | 'attempts'>): SkipReason | null {
  if (test.outcome !== 'skipped') return null;
  const skips = [...(test.attempts.at(-1)?.annotations ?? []), ...test.annotations].filter(isSkipAnnotation);
  if (skips.length === 0) return { kind: 'notRun', text: null };
  const described = skips.find((annotation) => annotation.description?.trim());
  const chosen = described ?? skips[0]!;
  return { kind: chosen.type, text: described?.description?.trim() ?? null };
}

const KIND_LABELS = { skip: 'Skipped', fixme: 'Fixme' } as const;

/** "Skipped: <reason>", "Fixme (no reason given)", "Not run". */
export function skipLabel(reason: SkipReason): string {
  if (reason.kind === 'notRun') return 'Not run';
  const kind = KIND_LABELS[reason.kind];
  return reason.text === null ? `${kind} (no reason given)` : `${kind}: ${reason.text}`;
}

/** The full text, for tooltips and accessible names: the label, plus the explanation of "Not run". */
export function skipDescription(reason: SkipReason): string {
  return reason.kind === 'notRun' ? `Not run. ${NOT_RUN_EXPLANATION}` : skipLabel(reason);
}
