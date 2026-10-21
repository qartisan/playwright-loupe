import { NOT_RUN_EXPLANATION, skipDescription, skipLabel, type SkipReason } from '../skip.js';

/**
 * Why a test was skipped, on one line: "Skipped: <reason>", "Fixme (no reason
 * given)", "Not run". The text is plain (never HTML from the annotation). The
 * tooltip and the accessible name carry the full text: the reason when CSS
 * truncates it, and the explanation of "Not run".
 */
export function SkipReasonText({ reason, class: className }: { reason: SkipReason; class: string }) {
  return (
    <span class={`skip-reason ${className}`} title={skipDescription(reason)}>
      {skipLabel(reason)}
      {reason.kind === 'notRun' && <span class="visually-hidden">. {NOT_RUN_EXPLANATION}</span>}
    </span>
  );
}
