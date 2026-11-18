import { HISTORY_STATES } from '../../shared/history.js';
import { STATE_HELP, STATE_LABEL, stateHelpId, whichRunsText } from '../history.js';
import { HistoryStateIcon } from './icons.js';

/**
 * What the history states mean, in a native disclosure: one tab stop, open
 * with the keyboard as with the mouse, no script. Each definition has the id
 * that markers and links of the view point to with aria-describedby, so a
 * screen reader reads it on focus even while the disclosure is closed. Render
 * it once per view, only when states are shown. It ends with which runs
 * each level uses, as cells of the strip say it for their run (cellUse),
 * under a heading at `headingLevel`, the next level in its view, in the
 * words of the report's `history.include`, naming its notes file (`notes`).
 */
export function HistoryHelp({ headingLevel, include, notes }: { headingLevel: 2 | 3 | 4; include: 'full' | 'all'; notes: string | null }) {
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
      <p>{whichRunsText(include, notes)}</p>
    </details>
  );
}
