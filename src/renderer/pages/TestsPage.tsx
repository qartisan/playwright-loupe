import { Component, Fragment } from 'preact';
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { LoupeReport, TestCase } from '../../schema/v1.js';
import { categoryColorMap } from '../categoryColors.js';
import { CategoryBadge } from '../components/CategoryBadge.js';
import { FacetMenus, FilterChips } from '../components/FilterBar.js';
import { CloseIcon, OutcomeIcon, SortIcon } from '../components/icons.js';
import { SkipReasonText } from '../components/SkipReason.js';
import { RerunFailed, projectLabel, testHref } from '../components/widgets.js';
import { CAP_STEP, cappedLength, resultSummary } from '../filters/cap.js';
import { chipFilters, collapsedChips, isChipActive, reportChips, type TestChip } from '../filters/chips.js';
import { facetCounts, shownCategories } from '../filters/match.js';
import { nextSort, titlePath } from '../filters/sort.js';
import { context, domain, filtersHref, setFilters } from '../filters/store.js';
import { DEFAULT_SORT, clearFilters, serializeFilters, type FilterState, type SortColumn } from '../filters/url.js';
import { formatDuration, plural } from '../format.js';
import { skipReason } from '../skip.js';

const COLUMNS: ReadonlyArray<{ column: SortColumn; label: string; numeric?: boolean }> = [
  { column: 'status', label: 'Status' },
  { column: 'title', label: 'Test' },
  { column: 'project', label: 'Project' },
  { column: 'file', label: 'File' },
  { column: 'duration', label: 'Duration', numeric: true },
  { column: 'category', label: 'Error category' },
  { column: 'attempts', label: 'Attempts', numeric: true },
];

/**
 * Tests (`#/tests`): every test of the run in one flat list, reduced by the
 * filter state (shared with the sidebar) and sorted by column. The first
 * `CAP_STEP` rows of the sorted list are rendered, more on demand; any
 * filter or sort change starts again from `CAP_STEP`.
 */
export function TestsPage({ report, state, sorted }: { report: LoupeReport; state: FilterState; sorted: readonly TestCase[] }) {
  const colors = useMemo(() => categoryColorMap(report.categories), [report]);
  const chips = reportChips(report);
  // Not recomputed when only the sort changes.
  const filterKey = serializeFilters({ ...state, sort: DEFAULT_SORT });
  const counts = useMemo(() => facetCounts(report.tests, state, domain.value, context.value), [report, filterKey]);
  const total = report.tests.length;

  // Any filter or sort change starts again from CAP_STEP, even back to a state shown in full
  // before. Reset during render, so the larger list is never rendered first.
  const viewKey = serializeFilters(state);
  const cap = useRef({ viewKey, limit: CAP_STEP });
  if (cap.current.viewKey !== viewKey) cap.current = { viewKey, limit: CAP_STEP };
  const [, rerender] = useState(0);
  const shown = cappedLength(sorted.length, cap.current.limit);
  const rows = useMemo(() => sorted.slice(0, shown), [sorted, shown]);
  const summary = resultSummary(shown, sorted.length, total);

  // "Show more" moves focus to the first row it added, so keyboard users continue from there.
  const body = useRef<HTMLTableSectionElement>(null);
  const focusRow = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (focusRow.current === null) return;
    body.current?.rows[focusRow.current]?.querySelector('a')?.focus();
    focusRow.current = null;
  });
  const showUpTo = (next: number): void => {
    focusRow.current = shown;
    cap.current = { viewKey, limit: next };
    rerender((count) => count + 1);
  };

  return (
    <div class="page view view-tests">
      <h1>Tests</h1>
      {total > 0 && (
        <div class="filter-bar">
          <FacetMenus state={state} domain={domain.value} counts={counts} colors={colors} />
          <FilterChips state={state} domain={domain.value} />
        </div>
      )}
      <p class="result-count" aria-live="polite" aria-atomic="true">
        {summary}
      </p>
      <RerunFailed tests={sorted} />
      {total === 0 ? (
        <p class="muted">No tests in this run.</p>
      ) : sorted.length === 0 ? (
        <div class="empty-state">
          <p>No tests match these filters.</p>
          <button type="button" class="button" onClick={() => setFilters(clearFilters(state))}>
            Reset filters
          </button>
        </div>
      ) : (
        <div class="table-scroll">
          <table class="tests-table">
            <thead>
              <tr>
                {COLUMNS.map(({ column, label, numeric }) => {
                  const active = state.sort.column === column;
                  return (
                    <th
                      key={column}
                      scope="col"
                      class={numeric ? 'numeric' : undefined}
                      aria-sort={active ? (state.sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}
                    >
                      <button type="button" class="sort-button" onClick={() => setFilters({ ...state, sort: nextSort(state.sort, column) })}>
                        {label}
                        <SortIcon direction={active ? state.sort.direction : null} class={active ? 'sort-active' : 'sort-idle'} />
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody ref={body}>
              {rows.map((test) => (
                <TestRow
                  key={`${test.id}/${test.repeatEachIndex}`}
                  test={test}
                  chips={chips.get(test.id) ?? NO_CHIPS}
                  state={state}
                  colors={colors}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {shown < sorted.length && (
        <div class="table-more">
          <p>{summary}</p>
          <button type="button" class="button" onClick={() => showUpTo(shown + CAP_STEP)}>
            Show {Math.min(CAP_STEP, sorted.length - shown)} more
          </button>
          <button type="button" class="button" onClick={() => showUpTo(sorted.length)}>
            Show all
          </button>
        </div>
      )}
    </div>
  );
}

/** A path that wraps after a `/`, never inside a name. */
function FilePath({ path }: { path: string }) {
  const parts = path.split('/');
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {part}
          {index < parts.length - 1 && (
            <>
              /<wbr />
            </>
          )}
        </Fragment>
      ))}
    </>
  );
}

/**
 * The category shown for a test, and `+N` when its failing attempts had
 * others: they are listed in the tooltip and the accessible name.
 */
function TestCategories({ test, colors }: { test: TestCase; colors: ReadonlyMap<string, string> }) {
  const { primary, others } = shownCategories(test);
  if (primary === null) return null;
  return (
    <span class="category-badges">
      <CategoryBadge name={primary} color={colors.get(primary)} />
      {others.length > 0 && (
        <span class="category-more" title={`Other ${others.length === 1 ? 'category' : 'categories'} in failing attempts: ${others.join(', ')}`}>
          <span aria-hidden="true">+{others.length}</span>
          <span class="visually-hidden">
            , and {plural(others.length, 'other category', 'other categories')}: {others.join(', ')}
          </span>
        </span>
      )}
    </span>
  );
}

const NO_CHIPS: readonly TestChip[] = [];

/**
 * The dimension values and free tags of a test, under its title. Each chip
 * links to the Tests view with its value added to the filter, or removed
 * when active. A collapsed row shows its active chips, then the others up
 * to `CHIP_CAP` chips, and "+N" for the rest, shown in place on demand;
 * that state is not in the URL.
 */
function TestChips({ chips, state }: { chips: readonly TestChip[]; state: FilterState }) {
  const [expanded, setExpanded] = useState(false);
  if (chips.length === 0) return null;
  const active = (chip: TestChip): boolean => isChipActive(state, chip);
  const collapsed = collapsedChips(chips, active);
  const shown = expanded ? chips : collapsed.shown;
  // One element per chip, in a named group: the row cost of a list (ul, li, span) is measurable on 500 rows.
  return (
    <div class="test-chips" role="group" aria-label="Tags and dimensions">
      {shown.map((chip) => {
        const isActive = active(chip);
        const name = isActive ? `Remove filter ${chip.name}` : chip.name;
        return (
          <a
            key={`${chip.facet}\u0000${chip.value}`}
            class={`test-chip${isActive ? ' test-chip-active' : ''}`}
            href={filtersHref(chipFilters(state, chip), { page: 'tests' })}
            title={name}
            aria-label={name}
          >
            {chip.label}
            {isActive && <CloseIcon />}
          </a>
        );
      })}
      {collapsed.hidden > 0 && (
        <button type="button" class="test-chip-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show less' : `+${collapsed.hidden}`}
          {!expanded && <span class="visually-hidden"> more tags and dimensions</span>}
        </button>
      )}
    </div>
  );
}

interface TestRowProps {
  test: TestCase;
  chips: readonly TestChip[];
  state: FilterState;
  colors: ReadonlyMap<string, string>;
}

/**
 * A row, rendered again only when one of its props changes: "Show more"
 * leaves the rows already shown untouched. A filter or sort change gives a
 * new state, which every row's chip links depend on.
 */
class TestRow extends Component<TestRowProps> {
  override shouldComponentUpdate(next: TestRowProps): boolean {
    const { test, chips, state, colors } = this.props;
    return next.test !== test || next.chips !== chips || next.state !== state || next.colors !== colors;
  }

  override render() {
    return <TestRowCells {...this.props} />;
  }
}

function TestRowCells({ test, chips, state, colors }: TestRowProps) {
  const reason = skipReason(test);
  return (
    <tr>
      <td>
        <OutcomeIcon outcome={test.outcome} labelled />
      </td>
      <td class="cell-title">
        <a href={testHref(test)}>{titlePath(test)}</a>
        {test.repeatEachIndex > 0 && <span class="row-note"> repeat {test.repeatEachIndex}</span>}
        {reason && <SkipReasonText reason={reason} class="skip-line" />}
        <TestChips chips={chips} state={state} />
      </td>
      <td class="cell-project">{projectLabel(test.project)}</td>
      <td>
        <code>
          <FilePath path={`${test.file}:${test.line}`} />
        </code>
      </td>
      <td class="numeric">{formatDuration(test.durationMs)}</td>
      <td>
        <TestCategories test={test} colors={colors} />
      </td>
      <td class="numeric">{test.attempts.length}</td>
    </tr>
  );
}
