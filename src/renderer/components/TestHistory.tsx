import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { EmbeddedRun } from '../../schema/history-v1.js';
import type { AttemptStatus, LoupeReport, TestCase } from '../../schema/v1.js';
import { countsForTests, otherStreams, runFlags, testCells, type HistoryCell, type ResultCode } from '../../shared/history.js';
import { formatRunStart } from '../datetime.js';
import { overlayOpen } from '../layout.js';
import { formatDuration } from '../format.js';
import {
  NO_RESULT_NOTE,
  NO_RETRIES_TEXT,
  RESULT_TEXT,
  STATE_LABEL,
  attemptsText,
  ORIGIN_TEXT,
  cellName,
  cellUse,
  exclusionCopyFor,
  countersText,
  failureGap,
  notesName,
  stateDetail,
  streamDefinition,
  streamName,
  type ReportHistory,
} from '../history.js';
import { CopyButton } from './CopyButton.js';
import { HistoryStateIcon } from './icons.js';

/** The History section's heading: the target of the state shown in the test detail's header. */
const HEADING_ID = 'detail-history';

/** Scrolls to the History section and focuses its heading (the header's state link). */
export function focusTestHistory(): void {
  const heading = document.getElementById(HEADING_ID);
  if (!heading) return;
  heading.tabIndex = -1;
  heading.scrollIntoView({ block: 'start' });
  heading.focus({ preventScroll: true });
}

/** What a run's copied exclusion needs from the block: the current run's history id and the notes file. */
type ExclusionSource = Pick<ReportHistory['analysis']['history'], 'current' | 'notesFile' | 'notesPath'>;

/** A cell of the strip: a run of the window, or the current run, set apart at the end. */
type StripCell = HistoryCell & { current: boolean };
type Include = ReportHistory['analysis']['history']['include'];

const ATTEMPT_CODE: Record<AttemptStatus, string> = { passed: 'P', failed: 'F', timedOut: 'T', skipped: 'S', interrupted: 'I' };
const OUTCOME_CODE = { passed: 'P', failed: 'F', flaky: 'K', skipped: 'S' } as const;

/** The current run as a cell: what the report says about it, in the shape of a run of the window. */
function currentCell(report: LoupeReport, test: TestCase, history: ReportHistory, column: number): StripCell {
  const block = history.analysis.history;
  const run: EmbeddedRun = {
    id: report.run.id,
    reportRunId: report.run.id,
    startedAt: report.run.startedAt,
    durationMs: report.run.durationMs,
    status: report.run.status,
    origin: block.current.origin,
    scope: report.run.scope,
    scopeReasons: report.run.scopeReasons,
    excluded: block.current.excluded,
    // From loupe.notes.json: only a deterministic id (a merge or CI job run again) can be in it.
    ...(block.current.notesExcluded !== undefined ? { notesExcluded: block.current.notesExcluded } : {}),
    ...(block.current.note !== undefined ? { note: block.current.note } : {}),
    commit: report.run.git.commit,
    branch: report.run.git.branch,
    stats: report.run.stats,
    projects: report.projects.map((project) => [project.name, project.retries]),
    sameSignatures: true,
  };
  const code = OUTCOME_CODE[test.outcome];
  const runCounts = countsForTests(run, block.include);
  return {
    index: column,
    run,
    code,
    attempts: test.attempts.map((attempt) => ATTEMPT_CODE[attempt.status]).join('') || null,
    flags: runFlags(run),
    runCounts,
    counts: runCounts && code !== 'S',
    // Its errors are in the attempts below: no extract here.
    failure: code === 'F' || code === 'K' ? { category: test.category, extract: null, compared: true } : null,
    current: true,
  };
}

/** The glyph of a result: its shape says the status, never the colour alone. */
function ResultGlyph({ code }: { code: ResultCode }) {
  const mark = {
    P: <path d="M5 8.3l2 2 4-4.3" />,
    F: <path d="M5.7 5.7l4.6 4.6m0-4.6l-4.6 4.6" />,
    K: <path d="M10.6 6A3 3 0 0 0 5.4 7M5.4 10A3 3 0 0 0 10.6 9M10.6 4.4V6H9M5.4 11.6V10H7" />,
    S: <path d="M5.5 8h5" />,
    '-': null,
  }[code];
  return (
    <svg class="strip-glyph" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <circle class="strip-disc" cx="8" cy="8" r="7" />
      {mark && <g class="strip-mark">{mark}</g>}
    </svg>
  );
}

/** Commit, short: the first 7 characters of a hash. */
const shortCommit = (commit: string) => commit.slice(0, 7);

/** The facts of a run, as lines of text, in the selected run's details: result, attempts, where it ran, its category. */
function runFacts(cell: StripCell): string[] {
  const facts = [`Result: ${RESULT_TEXT[cell.code]}`];
  const attempts = attemptsText(cell.attempts);
  if (attempts) facts.push(attempts);
  facts.push(`Origin: ${ORIGIN_TEXT[cell.run.origin]}`);
  if (cell.run.branch) facts.push(`Branch: ${cell.run.branch}`);
  if (cell.run.commit) facts.push(`Commit: ${shortCommit(cell.run.commit)}`);
  facts.push(`Run duration: ${formatDuration(cell.run.durationMs)}`);
  if (cell.failure?.category) facts.push(`Category: ${cell.failure.category}`);
  return facts;
}

/**
 * The selected run's details, as page content right after the strip: read in the page's order, never on hover,
 * never as a description or a live region. A heading, the facts, how the run is used (its reasons with their
 * sources) and its note, then its error: the extract whole (no inner scroll), why there is none, or, for the current
 * run, where its errors are. Its actions (Close) come right after the heading, first in the Tab order. Plain text,
 * never HTML. Close, or Escape (Strip), closes it, focus back on its option. Keeps the run id (`data-run-id`) for a
 * later link to that run's report.
 */
function SelectedRun({ cell, date, include, notes, source, onClose }: { cell: StripCell; date: string; include: Include; notes: string | null; source: ExclusionSource; onClose: () => void }) {
  const gap = failureGap(cell);
  // The run's history id: a past run's own; the current run's from the block (its cell holds the report's run id).
  const copy = exclusionCopyFor(cell.current ? source.current.id : cell.run.id, source);
  const use = cellUse(cell, include, notes);
  const id = `selected-run-${cell.index}`;
  return (
    <section
      class="run-selected"
      aria-labelledby={id}
      data-run-id={cell.run.id}
    >
      {/* The heading, then its actions: Tab from the strip reaches them first, and reading goes on from the top. */}
      <div class="run-selected-head">
        <h3 id={id}>
          Selected run, {date}
          {cell.current && ' (this run)'}
        </h3>
        {/* The run's actions: the useful one first, the copy of its exclusion and where it goes (as the Run details
            card's), and the dismissal last, at the end of the row. */}
        <div class="run-selected-actions">
          {copy && (
            <>
              <CopyButton label="Exclusion" text={() => copy.text}>
                Copy exclusion for this run
              </CopyButton>
              <span class="run-selected-copy-note">{copy.instruction}</span>
            </>
          )}
          <button type="button" class="button run-selected-close" onClick={onClose}>
            Close<span class="visually-hidden"> the selected run</span>
          </button>
        </div>
      </div>
      <ul class="run-selected-facts">
        {runFacts(cell).map((fact) => (
          <li key={fact}>{fact}</li>
        ))}
      </ul>
      {use && <p class="run-selected-use">{use}</p>}
      {/* Text people wrote: rendered as text, never as HTML. */}
      {cell.run.note !== undefined && <p class="run-selected-note">Note: {cell.run.note}</p>}
      {cell.current && cell.failure && <p class="history-note">Its errors are in the attempts below.</p>}
      {!cell.current && cell.failure?.extract && <pre class="run-selected-extract">{cell.failure.extract}</pre>}
      {!cell.current && gap && <p class="history-note">{gap}</p>}
    </section>
  );
}

/**
 * The strip: one option per run of the window, oldest first, then the current run, set apart (by CSS: nothing
 * but options in the listbox). A listbox, so screen readers pass its keys in focus mode: one tab stop (roving
 * tabindex), arrows move between options and stop at the ends, Home and End go to them, and moving selects
 * nothing. Click, tap, Enter or Space selects a run and opens its details (SelectedRun) right after the strip,
 * focus staying on the option; the selected run again, or Close, closes them, focus back on its option. Names are
 * short (cellName); nothing opens on hover. A cell keeps its run id (`data-run-id`).
 *
 * Escape closes the details too, from the strip or from inside them, including while a screen reader's browse
 * mode or caret browsing reads them: focus then rests on an ancestor (`main`) and only the selection's anchor is
 * in them, so the key is heard on the document. It acts when focus is in the strip or the details, or when the
 * focused element holds the selection's anchor and the anchor is in them; focus stays on an option of the strip,
 * or goes to the selected one. Never while the narrow drawer or a dialog is on top, never on a key already
 * handled (defaultPrevented), and never cancelled: the key goes on unchanged.
 */
function Strip({ cells, include, notes, source }: { cells: readonly StripCell[]; include: Include; notes: string | null; source: ExclusionSource }) {
  const last = cells.length - 1;
  const [active, setActive] = useState(last);
  const [selected, setSelected] = useState<number | null>(null);
  const list = useRef<HTMLDivElement>(null);
  // The month written out: these dates are in the options' names and the details' heading, spoken by screen readers.
  const dates = useMemo(() => cells.map((cell) => formatRunStart(cell.run.startedAt)?.long ?? cell.run.startedAt), [cells]);
  const cellAt = (index: number) => list.current?.querySelector<HTMLElement>(`[data-cell="${index}"]`);
  const focusCell = (index: number): void => {
    const target = Math.min(Math.max(index, 0), last);
    setActive(target);
    cellAt(target)?.focus();
  };
  const choose = (index: number): void => setSelected((current) => (current === index ? null : index));
  const close = (): void => {
    if (selected !== null) focusCell(selected);
    setSelected(null);
  };
  const shown = selected === null ? null : cells[selected];
  const block = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  // At once after the render that opens the details (a layout effect): an Escape pressed right away still closes them.
  useLayoutEffect(() => {
    if (selected === null) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || overlayOpen.value || document.querySelector('dialog[open]')) return;
      const root = block.current;
      const index = selectedRef.current;
      if (!root || index === null) return;
      const focus = document.activeElement;
      const anchor = document.getSelection()?.anchorNode ?? null;
      const reading = anchor !== null && root.contains(anchor) && focus !== null && focus.contains(anchor);
      if (!(focus !== null && root.contains(focus)) && !reading) return;
      const onOption = focus instanceof HTMLElement && focus.getAttribute('role') === 'option' && root.contains(focus);
      setSelected(null);
      if (!onOption) focusCell(index);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selected === null]);
  return (
    <div class="strip-block" ref={block}>
      <div class="strip-row">
        <div
          class="strip"
          role="listbox"
          aria-orientation="horizontal"
          aria-label="Runs of this test: select one to see its details"
          ref={list}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              choose(active);
              return;
            }
            const moves: Record<string, number> = { ArrowRight: active + 1, ArrowDown: active + 1, ArrowLeft: active - 1, ArrowUp: active - 1, Home: 0, End: last };
            const target = moves[event.key];
            if (target === undefined) return;
            event.preventDefault();
            focusCell(target);
          }}
        >
          {cells.map((cell, index) => {
            const name = cellName(cell, dates[index] ?? '');
            const classes = [
              'strip-cell',
              `strip-${cell.code === '-' ? 'none' : cell.code}`,
              cell.runCounts ? '' : 'strip-excluded',
              cell.runCounts && (cell.flags.includes('partial') || cell.flags.includes('ide')) ? 'strip-flagged' : '',
              cell.current ? 'strip-current' : '',
            ];
            return (
              <span
                key={cell.run.id}
                role="option"
                aria-selected={index === selected}
                class={classes.filter(Boolean).join(' ')}
                tabIndex={index === active ? 0 : -1}
                data-cell={index}
                data-run-id={cell.run.id}
                aria-label={cell.current ? `This run: ${name}` : name}
                onFocus={() => setActive(index)}
                onClick={() => {
                  focusCell(index);
                  choose(index);
                }}
              >
                <ResultGlyph code={cell.code} />
              </span>
            );
          })}
        </div>
        {/* Visible only: the listbox's name says it to screen readers. */}
        {shown === null && (
          <p class="strip-hint" aria-hidden="true">
            Select a run to see its details.
          </p>
        )}
      </div>
      {shown && selected !== null && <SelectedRun cell={shown} date={dates[selected] ?? ''} include={include} notes={notes} source={source} onClose={close} />}
    </div>
  );
}

/**
 * The rest of a test's history, closed by default so that the error stays
 * near the top: a native disclosure whose summary is the counters line, so the
 * key facts read while closed; inside, the no-retries line and the latest
 * result in every other stream. Without counters (no state shown), its
 * summary names the other streams. With nothing inside, no disclosure: the
 * counters alone are a plain line, and nothing at all without them.
 */
function HistoryMore({ counters, noRetries, others, stream }: { counters: string | null; noRetries: boolean; others: ReturnType<typeof otherStreams>; stream: ReportHistory['analysis']['history']['stream'] }) {
  const inside = noRetries || others.length > 0;
  if (!inside) return counters ? <p class="history-counters">{counters}</p> : null;
  return (
    <details class="history-more">
      <summary class={counters ? 'history-counters' : undefined}>{counters ?? 'Latest result in other streams'}</summary>
      {noRetries && <p class="history-note">{NO_RETRIES_TEXT}</p>}
      {others.length > 0 && (
        <>
          {counters && <h3 class="history-others-title">Latest result in other streams</h3>}
          <p class="history-note">{streamDefinition(stream)}</p>
          <ul class="history-others">
            {others.map((other) => {
              const date = formatRunStart(other.startedAt);
              return (
                <li key={other.id} class={`history-other strip-${other.code === '-' ? 'none' : other.code}`} data-run-id={other.id}>
                  <ResultGlyph code={other.code} />
                  <span class="history-other-stream">{streamName(other.stream)}</span>
                  {date && <time dateTime={date.utc}>{date.label}</time>}
                  <span>
                    {other.code === '-' ? (
                      <>
                        No result<span aria-hidden="true">*</span>
                      </>
                    ) : (
                      RESULT_TEXT[other.code]
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          {others.some((other) => other.code === '-') && <p class="history-note">* {NO_RESULT_NOTE}</p>}
        </>
      )}
    </details>
  );
}

/**
 * The history of a test in its detail, compact so that the error stays near
 * the top: always its state with its N and its strip; the counters, the
 * no-retries line and the other streams in a closed disclosure (HistoryMore).
 * Rendered only with history. When no state is shown (first run, earlier runs
 * unreadable or all excluded), the strip and the other streams still show,
 * without state or counters.
 */
export function TestHistory({ history, report, test }: { history: ReportHistory; report: LoupeReport; test: TestCase }) {
  const row = history.rows.get(test);
  const { analysis } = history;
  const block = analysis.history;
  const cells = useMemo(
    () => (row === undefined || block.runs.length === 0 ? [] : [...testCells(block, history.index, row).map((cell) => ({ ...cell, current: false })), currentCell(report, test, history, block.runs.length)]),
    [test, history],
  );
  if (row === undefined) return null;
  const others = otherStreams(block, row);
  if (cells.length === 0 && others.length === 0) return null;
  const facts = history.byTest.get(test);
  const shown = analysis.statesShown && facts;
  return (
    <section class="detail-section test-history" aria-labelledby={HEADING_ID} data-history>
      <h2 id={HEADING_ID}>
        History <span class="verdict-history-stream">{streamName(block.stream)}</span>
      </h2>
      {shown && facts.state && (
        // The lead line: the state larger and bold, no colour (sage and red are statuses, hues are categories).
        <p class="history-test-state">
          <strong class="history-test-state-label">
            <HistoryStateIcon state={facts.state} />
            {STATE_LABEL[facts.state]}
          </strong>
          <span class="visually-hidden">:</span>{' '}
          {stateDetail(facts.state, facts.earlier)}
        </p>
      )}
      {cells.length > 0 && <Strip key={`${test.id}:${test.repeatEachIndex}`} cells={cells} include={block.include} notes={notesName(block)} source={block} />}
      <HistoryMore counters={shown && facts.counters.considered > 0 ? countersText(facts.counters, !facts.noRetries) : null} noRetries={Boolean(shown && facts.noRetries)} others={others} stream={block.stream} />
    </section>
  );
}
