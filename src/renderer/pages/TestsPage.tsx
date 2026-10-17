import { Fragment } from 'preact';
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { LoupeReport, TestCase } from '../../schema/v1.js';
import { categoryColorMap } from '../categoryColors.js';
import { CategoryBadge } from '../components/CategoryBadge.js';
import { FacetMenus, FilterChips } from '../components/FilterBar.js';
import { OutcomeIcon, SortIcon } from '../components/icons.js';
import { projectLabel, testHref } from '../components/widgets.js';
import { CAP_STEP, cappedLength, resultSummary } from '../filters/cap.js';
import { facetCounts, shownCategories } from '../filters/match.js';
import { buildSortRanks, nextSort, sortTests, titlePath } from '../filters/sort.js';
import { context, domain, setFilters } from '../filters/store.js';
import { DEFAULT_SORT, clearFilters, serializeFilters, type FilterState, type SortColumn } from '../filters/url.js';
import { formatDuration, plural } from '../format.js';

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
export function TestsPage({ report, state, matched }: { report: LoupeReport; state: FilterState; matched: readonly TestCase[] }) {
  const colors = useMemo(() => categoryColorMap(report.categories), [report]);
  // Not recomputed when only the sort changes.
  const filterKey = serializeFilters({ ...state, sort: DEFAULT_SORT });
  const counts = useMemo(() => facetCounts(report.tests, state, domain.value, context.value), [report, filterKey]);
  const ranks = useMemo(() => buildSortRanks(report.tests), [report]);
  const sorted = useMemo(() => sortTests(matched, state.sort, ranks), [matched, ranks, state.sort.column, state.sort.direction]);
  const total = report.tests.length;

  // Any filter or sort change starts again from CAP_STEP, even back to a state shown in full
  // before. Reset during render, so the larger list is never rendered first.
  const viewKey = serializeFilters(state);
  const cap = useRef({ viewKey, limit: CAP_STEP });
  if (cap.current.viewKey !== viewKey) cap.current = { viewKey, limit: CAP_STEP };
  const [, rerender] = useState(0);
  const shown = cappedLength(sorted.length, cap.current.limit);
  const rows = useMemo(() => sorted.slice(0, shown), [sorted, shown]);
  const summary = resultSummary(shown, matched.length, total);

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
                <TestRow key={`${test.id}/${test.repeatEachIndex}`} test={test} colors={colors} />
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

function TestRow({ test, colors }: { test: TestCase; colors: ReadonlyMap<string, string> }) {
  return (
    <tr>
      <td>
        <OutcomeIcon outcome={test.outcome} labelled />
      </td>
      <td class="cell-title">
        <a href={testHref(test)}>{titlePath(test)}</a>
        {test.repeatEachIndex > 0 && <span class="row-note"> repeat {test.repeatEachIndex}</span>}
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
