import { HISTORY_STATES } from '../../shared/history.js';
import { STATE_HELP, STATE_LABEL, stateHelpId } from '../history.js';
import { HistoryStateIcon } from './icons.js';

/**
 * What the history states mean, in a native disclosure: one tab stop, open
 * with the keyboard as with the mouse, no script. Each definition has the id
 * that markers and links of the view point to with aria-describedby, so a
 * screen reader reads it on focus even while the disclosure is closed. Render
 * it once per view, only when states are shown. It ends with which runs
 * each level uses, as cells of the strip say it for their run (cellUse),
 * under a heading at `headingLevel`, the next level in its view.
 */
export function HistoryHelp({ headingLevel }: { headingLevel: 2 | 3 | 4 }) {
  const Heading = `h${headingLevel}` as 'h2';
  return (
    <details class="history-help">
      <summary>What the history states mean</summary>
      <dl>
        {HISTORY_STATES.map((state) => (
          <div key={state}>
            <dt>
              <HistoryStateIcon state={state} /> {STATE_LABEL[state]}
            </dt>
            <dd id={stateHelpId(state)}>{STATE_HELP[state]}.</dd>
          </div>
        ))}
      </dl>
      <Heading class="history-help-title">Which runs are used</Heading>
      <p>
        Run comparisons (the changes since the last run, on the dashboard) use full runs outside the IDE that are not excluded. A test's history (its
        state, counters and strip) uses every run where it ran, except excluded ones.
      </p>
    </details>
  );
}
