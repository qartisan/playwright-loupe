import { useMemo, useRef, useState } from 'preact/hooks';
import type { EmbeddedRun } from '../../schema/history-v1.js';
import type { AttemptStatus, LoupeReport, TestCase } from '../../schema/v1.js';
import { countsForTests, otherStreams, runFlags, testCells, type HistoryCell, type ResultCode } from '../../shared/history.js';
import { formatRunStart } from '../datetime.js';
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
  countersText,
  failureGap,
  stateDetail,
  streamDefinition,
  streamName,
  type ReportHistory,
} from '../history.js';
import { HistoryStateIcon } from './icons.js';

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

/** The facts of a cell, as lines of text: for its description (read on focus) and the visible panel. */
function cellFacts(cell: StripCell, date: string, include: Include): string[] {
  const facts = [cell.current ? `This run, ${date}` : `Run of ${date}`, `Result: ${RESULT_TEXT[cell.code]}`];
  const attempts = attemptsText(cell.attempts);
  if (attempts) facts.push(attempts);
  facts.push(`Origin: ${ORIGIN_TEXT[cell.run.origin]}`);
  if (cell.run.branch) facts.push(`Branch: ${cell.run.branch}`);
  if (cell.run.commit) facts.push(`Commit: ${shortCommit(cell.run.commit)}`);
  facts.push(`Run duration: ${formatDuration(cell.run.durationMs)}`);
  // Nothing for an ordinary run; otherwise how the run is used, in one sentence.
  const use = cellUse(cell, include);
  if (use) facts.push(use);
  if (cell.failure?.category) facts.push(`Category: ${cell.failure.category}`);
  return facts;
}

function CellDetails({ cell, date, include }: { cell: StripCell; date: string; include: Include }) {
  const gap = failureGap(cell);
  return (
    <div class="strip-details" data-run-id={cell.run.id}>
      <ul class="strip-facts">
        {cellFacts(cell, date, include).map((fact) => (
          <li key={fact}>{fact}</li>
        ))}
      </ul>
      {cell.current && cell.failure && <p class="history-note">Its errors are in the attempts below.</p>}
      {!cell.current && cell.failure?.extract && <pre class="strip-extract">{cell.failure.extract}</pre>}
      {!cell.current && gap && <p class="history-note">{gap}</p>}
    </div>
  );
}

/**
 * The strip: one cell per run of the window, oldest first, then the current
 * run, set apart. One tab stop (roving tabindex): arrow keys move between
 * cells and stop at the ends, Home and End go to them. Each cell has a full
 * accessible name, and its facts as its description. The panel under the
 * strip shows the hovered or focused cell, only then: it floats over what
 * follows, so nothing moves, and stays while the pointer is over it. A cell
 * keeps its run id (`data-run-id`) for a later link to that run's report.
 */
function Strip({ cells, include }: { cells: readonly StripCell[]; include: Include }) {
  const last = cells.length - 1;
  const [active, setActive] = useState(last);
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const dates = useMemo(() => cells.map((cell) => formatRunStart(cell.run.startedAt)?.label ?? cell.run.startedAt), [cells]);
  const focusCell = (index: number): void => {
    const target = Math.min(Math.max(index, 0), last);
    setActive(target);
    list.current?.querySelector<HTMLElement>(`[data-cell="${target}"]`)?.focus();
  };
  const shownIndex = hovered ?? focused;
  const shown = shownIndex === null ? null : cells[shownIndex];
  return (
    <div class="strip-block" onMouseLeave={() => setHovered(null)}>
      <div
        class="strip"
        role="list"
        aria-label={`Results in this stream, oldest first, then this run (${cells.length})`}
        ref={list}
        onKeyDown={(event) => {
          const moves: Record<string, number> = { ArrowRight: active + 1, ArrowDown: active + 1, ArrowLeft: active - 1, ArrowUp: active - 1, Home: 0, End: last };
          const target = moves[event.key];
          if (target === undefined) return;
          event.preventDefault();
          focusCell(target);
        }}
      >
        {cells.map((cell, index) => {
          const name = cellName(cell, dates[index] ?? '', include);
          const classes = [
            'strip-cell',
            `strip-${cell.code === '-' ? 'none' : cell.code}`,
            cell.runCounts ? '' : 'strip-excluded',
            cell.runCounts && (cell.flags.includes('partial') || cell.flags.includes('ide')) ? 'strip-flagged' : '',
            cell.current ? 'strip-current' : '',
            index === shownIndex ? 'strip-active' : '',
          ];
          return [
            cell.current && cells.length > 1 ? <span key="gap" class="strip-gap" aria-hidden="true" /> : null,
            <span
              key={cell.run.id}
              role="listitem"
              class={classes.filter(Boolean).join(' ')}
              tabIndex={index === active ? 0 : -1}
              data-cell={index}
              data-run-id={cell.run.id}
              aria-label={cell.current ? `This run: ${name}` : name}
              aria-describedby={`strip-facts-${index}`}
              onFocus={() => {
                setActive(index);
                setFocused(index);
              }}
              onBlur={() => setFocused(null)}
              onMouseEnter={() => setHovered(index)}
              onClick={() => focusCell(index)}
            >
              <ResultGlyph code={cell.code} />
              <span id={`strip-facts-${index}`} hidden>
                {[...cellFacts(cell, dates[index] ?? '', include).slice(2), ...(cell.current ? [] : [cell.failure?.extract ?? failureGap(cell) ?? ''])].filter(Boolean).join('. ')}
              </span>
            </span>,
          ];
        })}
      </div>
      {shown && shownIndex !== null && <CellDetails cell={shown} date={dates[shownIndex] ?? ''} include={include} />}
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
    <section class="detail-section test-history" aria-labelledby="detail-history" data-history>
      <h2 id="detail-history">
        History <span class="verdict-history-stream">{streamName(block.stream)}</span>
      </h2>
      {shown && facts.state && (
        <p class="history-test-state">
          <span class="test-chip history-marker-static">
            <HistoryStateIcon state={facts.state} />
            {STATE_LABEL[facts.state]}
          </span>
          <span class="visually-hidden">:</span>{' '}
          {stateDetail(facts.state, facts.earlier)}
        </p>
      )}
      {cells.length > 0 && <Strip cells={cells} include={block.include} />}
      <HistoryMore counters={shown && facts.counters.considered > 0 ? countersText(facts.counters, !facts.noRetries) : null} noRetries={Boolean(shown && facts.noRetries)} others={others} stream={block.stream} />
    </section>
  );
}
