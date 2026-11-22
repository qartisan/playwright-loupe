import { HISTORY_STATES } from '../../shared/history.js';
import { formatRunStart } from '../datetime.js';
import { plural } from '../format.js';
import {
  STATE_HELP,
  formatFailedChange,
  formatPoints,
  noDeltaText,
  noStatesText,
  notesInvalidText,
  notesName,
  runsLeftOutText,
  stateCount,
  stateHelpId,
  streamName,
  trimmedText,
  type ReportHistory,
} from '../history.js';
import { facetHref } from '../filters/store.js';
import { HistoryHelp } from './HistoryHelp.js';
import { HistoryNotice } from './HistoryNotice.js';

/**
 * The history part of the verdict: the change since the previous run that
 * counts at run level (or why there is none), the tests in each history
 * state, each linking to the Tests view filtered on it (or why no state is
 * shown), and the run-level notices. Rendered only with history: without
 * it, the verdict has no history zone at all. With states, the Overview's
 * "What the history states mean" disclosure follows them: each count link
 * points to its state's definition (aria-describedby), read on focus even
 * while the disclosure is closed; the title stays for the mouse.
 */
export function VerdictHistory({ history }: { history: ReportHistory }) {
  const { analysis } = history;
  const { delta, noDelta, history: block } = analysis;
  const previous = delta ? formatRunStart(delta.previous.startedAt) : null;
  const signatures = analysis.signatureBreak ? formatRunStart(analysis.signatureBreak.before) : null;
  const trimmed = trimmedText(block);
  const runsLeftOut = runsLeftOutText(block.trimmed);
  return (
    <div class="verdict-history" data-history>
      <h3 class="verdict-history-title">
        History <span class="verdict-history-stream">{streamName(block.stream)}</span>
      </h3>
      {/* At the top: what the report left out to stay small reads before any figure it changes. */}
      {trimmed && <HistoryNotice>{trimmed}</HistoryNotice>}
      {delta ? (
        <p class="history-delta">
          Since the previous {block.include === 'all' ? '' : 'full '}run
          {previous && (
            <>
              {' '}
              (<time dateTime={previous.utc} title={previous.full}>{previous.label}</time>)
            </>
          )}
          : pass rate{' '}
          <strong>{delta.passRatePoints === null ? 'not comparable' : formatPoints(delta.passRatePoints)}</strong> ·{' '}
          <strong>{formatFailedChange(delta.failed)}</strong>
        </p>
      ) : (
        // "No earlier run" says less than the reason no state is shown (first run, all skipped, all excluded): that line alone.
        noDelta && !(noDelta === 'no-earlier-run' && analysis.noStates) && <p class="history-note">{noDeltaText(noDelta, block.current, block.include, notesName(block))}</p>
      )}
      {analysis.statesShown ? (
        <ul class="history-states" aria-label="Tests by history state">
          {HISTORY_STATES.map((state) => {
            const count = analysis.counts[state];
            return (
              <li key={state} class={`history-state state-${state}${count === 0 ? ' history-state-empty' : ''}`} title={STATE_HELP[state]}>
                {count > 0 ? (
                  <a href={facetHref('history', state)} aria-describedby={stateHelpId(state)}>
                    {stateCount(state, count)}
                  </a>
                ) : (
                  <span>{stateCount(state, count)}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        analysis.noStates && <p class="history-note">{noStatesText(analysis.noStates, notesName(block))}</p>
      )}
      {signatures && (
        <HistoryNotice>
          Loupe's error signatures changed: errors before <time dateTime={signatures.utc}>{signatures.label}</time> are not compared.
        </HistoryNotice>
      )}
      {analysis.skipped > 0 && analysis.noStates !== 'all-skipped' && (
        <HistoryNotice>
          {plural(analysis.skipped, 'earlier run file')} of this stream could not be read (a newer history format, or unreadable files): the window is shorter.
        </HistoryNotice>
      )}
      {block.notesFile === 'invalid' && <HistoryNotice>{notesInvalidText(notesName(block))}</HistoryNotice>}
      {analysis.statesShown && runsLeftOut && <HistoryNotice>{runsLeftOut}</HistoryNotice>}
      {analysis.statesShown && <HistoryHelp headingLevel={4} include={block.include} notes={notesName(block)} />}
    </div>
  );
}
