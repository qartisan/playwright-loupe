import { HISTORY_STATES } from '../../shared/history.js';
import { STATE_HELP, STATE_LABEL, stateHelpId } from '../history.js';
import { HistoryStateIcon } from './icons.js';

/**
 * What the history states mean, in a native disclosure: one tab stop, open
 * with the keyboard as with the mouse, no script. Each definition has the id
 * that markers and links of the view point to with aria-describedby, so a
 * screen reader reads it on focus even while the disclosure is closed. Render
 * it once per view, only when states are shown.
 */
export function HistoryHelp() {
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
    </details>
  );
}
