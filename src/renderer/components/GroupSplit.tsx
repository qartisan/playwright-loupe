import type { ErrorGroup } from '../dashboard.js';
import { OutcomeIcon } from './icons.js';

/** How many affected tests finally failed and how many were flaky, each with its status icon. */
export function GroupSplit({ group }: { group: Pick<ErrorGroup, 'failed' | 'flaky'> }) {
  const parts = (['failed', 'flaky'] as const).filter((outcome) => group[outcome] > 0);
  return (
    <span class="group-split">
      {parts.map((outcome) => (
        <span key={outcome} class={`group-split-part split-${outcome}`}>
          <OutcomeIcon outcome={outcome} decorative />
          {group[outcome]} {outcome}
        </span>
      ))}
    </span>
  );
}
