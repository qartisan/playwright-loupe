import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import type { CategoryDefinition, LoupeReport, RunError, TestCase } from '../../schema/v1.js';
import { categoryStyle } from '../categoryColors.js';
import {
  NO_CATEGORY,
  PASS_RATE_HELP,
  dimensionRepresentation,
  errorHeadline,
  formatPassRate,
  groupAttempts,
  groupSummary,
  outcomeShares,
  passRate,
  splitAfterTimeout,
  tileOrder,
  tileSummary,
  verdict,
  worstStatus,
  type CategoryCount,
  type DimensionDistribution,
  type DimensionValueCounts,
  type ErrorGroup,
  type FlakyTest,
  type ProjectSummary,
  type SkippedTest,
} from '../dashboard.js';
import type { FailurePoint } from '../failure-points/points.js';
import { filters, filtersHref } from '../filters/store.js';
import { EMPTY_FILTERS, dimensionFacet, type FacetId } from '../filters/url.js';
import { formatDuration, plural } from '../format.js';
import { foldedGroupsText, groupCountText } from '../secondary.js';
import { revealInSidebar } from '../layout.js';
import { hrefTo } from '../navigation.js';
import { UNNAMED_PROJECT, projectKey } from '../tree.js';
import { LONG_COMMAND_TESTS, RERUN_HELP, failedTests, rerunCommand } from '../detail/rerun.js';
import { CategoryBadge } from './CategoryBadge.js';
import { CopyButton } from './CopyButton.js';
import { GroupSplit } from './GroupSplit.js';
import { SkipReasonText } from './SkipReason.js';
import { AlertIcon, ChevronIcon, OutcomeIcon, outcomeLabel } from './icons.js';

/** Widgets shared by the overview, errors and suite health views. */

export type Colors = ReadonlyMap<string, string>;

/** Where the dimension options are documented, for the hint shown when a dimension declares no values. */
const DIMENSIONS_DOCS = 'https://github.com/qartisan/playwright-loupe/blob/main/docs/config.md#dimensions';

export function testHref(test: TestCase): string {
  return hrefTo({ page: 'test', id: test.id, repeatEachIndex: test.repeatEachIndex });
}

/**
 * Link to an error group. `category` is the category the link is listed
 * under: the group page then walks the groups of that category only. Without
 * it (the global list), the link clears the category filter and the group
 * page walks every group.
 */
export function groupHref(signature: string, category?: string): string {
  const state = filters.value;
  return filtersHref({ ...state, facets: { ...state.facets, category: category === undefined ? [] : [category] } }, { page: 'group', signature });
}

/** Link to the Tests view showing the tests with this value, replacing the current filters. */
export function facetHref(facet: FacetId, value: string): string {
  return filtersHref({ ...EMPTY_FILTERS, facets: { [facet]: [value] } }, { page: 'tests' });
}

export function projectLabel(name: string): string {
  return name || UNNAMED_PROJECT;
}

/** The pass rate, labeled, with its definition as a tooltip (and for screen readers). */
export function PassRate({ rate }: { rate: number }) {
  return (
    <span class="pass-rate" title={PASS_RATE_HELP}>
      <strong>{formatPassRate(rate)}</strong> pass rate<span class="visually-hidden"> (skipped tests excluded)</span>
    </span>
  );
}

export function Widget({
  id,
  title,
  note,
  class: className,
  children,
}: {
  id: string;
  title: ComponentChildren;
  note?: ComponentChildren;
  class?: string;
  children: ComponentChildren;
}) {
  return (
    <section class={`widget ${className ?? ''}`} aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {note && <p class="widget-note">{note}</p>}
      {children}
    </section>
  );
}

/**
 * The run's outcome, a stacked bar of the outcomes, the pass rate and the
 * duration. The counts are in the header, so they are not repeated here.
 */
export function Verdict({ report, children }: { report: LoupeReport; children?: ComponentChildren }) {
  const outcome = verdict(report);
  const { stats } = report.run;
  const shares = outcomeShares(stats);
  const rate = passRate(stats);
  const summary = shares.map(({ outcome: key, count }) => `${count} ${outcomeLabel(key).toLowerCase()}`).join(', ');
  return (
    <section class="widget widget-verdict" aria-labelledby="w-verdict">
      <h2 id="w-verdict" class="visually-hidden">
        Verdict
      </h2>
      <div class="verdict">
        <p class={`verdict-outcome outcome-${outcome}`} data-verdict={outcome}>
          <OutcomeIcon outcome={outcome} decorative />
          <span>{outcomeLabel(outcome)}</span>
        </p>
        <p class="verdict-meta">
          {rate !== null && (
            <>
              <PassRate rate={rate} /> ·{' '}
            </>
          )}
          {plural(stats.total, 'test')} in <strong>{formatDuration(report.run.durationMs)}</strong>
        </p>
      </div>
      {children}
      {shares.length > 0 && (
        <>
          <div class="outcome-bar" role="img" aria-label={summary}>
            {shares.map(({ outcome: key, count, share }) => (
              <span
                key={key}
                class={`outcome-bar-part bar-${key}`}
                style={{ flexGrow: share }}
                title={`${count} ${outcomeLabel(key).toLowerCase()}`}
              />
            ))}
          </div>
          <ul class="outcome-legend" aria-hidden="true">
            {shares.map(({ outcome: key, count }) => (
              <li key={key}>
                <OutcomeIcon outcome={key} decorative />
                {count} {outcomeLabel(key).toLowerCase()}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * Copies the command rerunning the failed tests of a list (flaky tests left
 * out), every one of them, not only the rows shown. Nothing when none failed.
 */
export function RerunFailed({ tests, action = 'Copy rerun command' }: { tests: readonly TestCase[]; action?: string }) {
  const failed = failedTests(tests);
  if (failed.length === 0) return null;
  return (
    <div class="rerun-failed">
      <CopyButton label="Rerun command" help={RERUN_HELP} text={() => rerunCommand(failed)}>
        {action} · {plural(failed.length, 'failed test')}
      </CopyButton>
      {failed.length > LONG_COMMAND_TESTS && (
        <p class="rerun-note">The command lists {plural(failed.length, 'test')}: it is long, and some terminals may cut it.</p>
      )}
    </div>
  );
}

/** Run errors in short, linking to the errors view. */
export function RunErrorsSummary({ errors }: { errors: readonly RunError[] }) {
  return (
    <Widget
      id="w-run-errors"
      class="widget-run-errors"
      title={
        <>
          <AlertIcon />
          {plural(errors.length, 'error')} outside tests
        </>
      }
      note="A file that failed to load, a global setup or teardown, a worker teardown: Playwright may have run fewer tests."
    >
      <ul class="widget-list">
        {errors.slice(0, 3).map((error, index) => (
          <li key={index}>
            <code>{errorHeadline(error.message)}</code>
          </li>
        ))}
      </ul>
      <p class="widget-more">
        <a href={hrefTo({ page: 'errors' })}>See the errors</a>
      </p>
    </Widget>
  );
}

/** A run error in full: category, project, location, message, snippet and stack. */
export function RunErrorItem({ error, color }: { error: RunError; color: string | undefined }) {
  const location = error.location ? `${error.location.file}:${error.location.line}:${error.location.column}` : null;
  return (
    <li class="run-error">
      <div class="run-error-meta">
        {error.category && <CategoryBadge name={error.category} color={color} />}
        {error.project !== null && <span>Project {error.project || '(unnamed)'}</span>}
        {location && <code>{location}</code>}
      </div>
      <pre class="message error-message">{error.message}</pre>
      {error.snippet && (
        // Focusable, so it scrolls sideways with the keyboard.
        <pre class="code-snippet" tabIndex={0}>
          {error.snippet}
        </pre>
      )}
      {error.stack && error.stack !== error.message && (
        <details>
          <summary>Stack trace</summary>
          <pre class="stack">{error.stack}</pre>
        </details>
      )}
    </li>
  );
}

/**
 * One error group on one row: category, failed / flaky split, the first
 * affected test (and how many others), and the line that tells the error apart.
 * In a category's group list (`inCategory`), the badge would only repeat the
 * category every row shares: it is left out, and the link carries the
 * category as context for the group page's previous / next.
 */
export function GroupRow({ group, colors, inCategory }: { group: ErrorGroup; colors: Colors; inCategory?: string | undefined }) {
  const { headline, firstTest, others } = groupSummary(group);
  const attempts = groupAttempts(group);
  return (
    <a class="group-row" href={groupHref(group.signature, inCategory)}>
      <span class="group-row-head">
        {inCategory === undefined && <CategoryBadge name={group.category} color={colors.get(group.category)} />}
        <span class="group-row-counts">
          <GroupSplit group={group} />
          {attempts && <span class="group-attempts">{attempts}</span>}
        </span>
      </span>
      {firstTest && (
        <span class="group-test">
          {firstTest.title}
          {others > 0 && <span class="muted"> +{plural(others, 'other')}</span>}
        </span>
      )}
      <code class="group-message">{headline}</code>
    </a>
  );
}

export function GroupList({ groups, colors, inCategory }: { groups: readonly ErrorGroup[]; colors: Colors; inCategory?: string | undefined }) {
  return (
    <ol class="widget-list group-list">
      {groups.map((group) => (
        <li key={group.signature}>
          <GroupRow group={group} colors={colors} inCategory={inCategory} />
        </li>
      ))}
    </ol>
  );
}

/** Categories in the report's order (rule order), uncategorized last. */
function inCategoryOrder(names: readonly string[], definitions: readonly CategoryDefinition[]): string[] {
  const order = definitions.map((definition) => definition.name);
  const rank = (name: string): number => (name === NO_CATEGORY ? Infinity : order.includes(name) ? order.indexOf(name) : order.length);
  return [...names].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Common failure points (failure-points/points.ts): functions of the user's
 * code in the stacks of failures across files and error groups, each linking
 * to its tests in the Tests view. Leads, never presented as a diagnosis.
 */
export function FailurePointsWidget({ points, colors, categories }: { points: readonly FailurePoint[]; colors: Colors; categories: readonly CategoryDefinition[] }) {
  return (
    <Widget
      id="w-failure-points"
      class="widget-failure-points"
      title="Common failure points"
      note="Functions from your code that appear in the stack of several failures, in different files and error groups. A lead, not a diagnosis."
    >
      <ol class="widget-list point-list">
        {points.map((point) => (
          <li key={point.key} data-point={point.key}>
            <a class="point-row" href={facetHref('point', point.key)}>
              <code class="point-fn">{point.fn}</code>
              <span class="point-where">
                <code>{point.file}</code> · {point.lines.length === 1 ? 'line' : 'lines'} {point.lines.join(', ')}
              </span>
              {point.via.length > 0 && (
                <span class="point-via">
                  via{' '}
                  {point.via.map((inner, index) => (
                    <span key={inner.key}>
                      {index > 0 && ', '}
                      <code title={inner.key}>{inner.fn}</code>
                    </span>
                  ))}
                </span>
              )}
              <span class="point-counts">
                <span class="group-count">
                  {plural(point.tests, 'test')} · {plural(point.files, 'file')} · {plural(point.signatures.length, 'error group')}
                </span>
                {point.flaky > 0 && <GroupSplit group={point} />}
              </span>
              <span class="point-categories">
                {inCategoryOrder(point.categories, categories).map((name) => (
                  <CategoryBadge key={name} name={name} color={colors.get(name)} />
                ))}
              </span>
            </a>
          </li>
        ))}
      </ol>
    </Widget>
  );
}

/**
 * The groups only seen after a test timeout, at the end of a group list, in
 * a collapsed disclosure: noise in the lists, still one click away. Their
 * pages stay reachable, and the errors stay in each test's detail.
 */
export function FoldedGroups({ groups, colors, inCategory }: { groups: readonly ErrorGroup[]; colors: Colors; inCategory?: string | undefined }) {
  if (groups.length === 0) return null;
  return (
    <details class="after-timeout">
      <summary>
        <ChevronIcon class="chevron" />
        {foldedGroupsText(groups.length)}
      </summary>
      <p class="widget-note">Raised by the action still running when the test timed out: never the first error of an attempt.</p>
      <GroupList groups={groups} colors={colors} inCategory={inCategory} />
    </details>
  );
}

/** Failing tests per category as bars, each linking to those tests in the Tests view. */
export function CategoryBars({ categories, colors }: { categories: readonly CategoryCount[]; colors: Colors }) {
  const max = Math.max(...categories.map((category) => category.tests), 1);
  return (
    <ul class="widget-list category-bars">
      {categories.map((category) => (
        <li key={category.name}>
          <a class="category-bar-row" href={facetHref('category', category.name)}>
            <CategoryBadge name={category.name} color={colors.get(category.name)} />
            <span class="category-bar-track" aria-hidden="true">
              <span class="category-bar" style={{ ...categoryStyle(colors.get(category.name)), width: `${(category.tests / max) * 100}%` }} />
            </span>
            <span class="group-count">{plural(category.tests, 'test')}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * Categories with their group and test counts, each expanding to its groups,
 * the groups only seen after a test timeout folded at the end (and left out
 * of the group count, not of the test count); `open` starts expanded.
 */
export function CategoryDetails({ categories, colors, open }: { categories: readonly CategoryCount[]; colors: Colors; open?: string | undefined }) {
  return (
    <ul class="widget-list category-list">
      {categories.map((category) => {
        const { visible, folded } = splitAfterTimeout(category.groups);
        return (
          <li key={category.name} data-category={category.name}>
            <details open={category.name === open}>
              <summary>
                <ChevronIcon class="chevron" />
                <CategoryBadge name={category.name} color={colors.get(category.name)} />
                <span class="muted">{groupCountText(visible.length, folded.length)}</span>
                <span class="group-count">{plural(category.tests, 'test')}</span>
              </summary>
              {visible.length > 0 && <GroupList groups={visible} colors={colors} inCategory={category.name} />}
              <FoldedGroups groups={folded} colors={colors} inCategory={category.name} />
            </details>
          </li>
        );
      })}
    </ul>
  );
}

export function ProjectCards({ projects }: { projects: readonly ProjectSummary[] }) {
  return (
    <ul class="project-cards">
      {projects.map(({ project, passRate: rate, durationMs }) => (
        <li key={project.name}>
          <button
            type="button"
            class="project-card"
            aria-controls="sidebar"
            title="Show this project in the sidebar"
            onClick={() => revealInSidebar(projectKey(project.name))}
          >
            <span class="project-name">{projectLabel(project.name)}</span>
            <span class="counts">
              {(['passed', 'failed', 'flaky', 'skipped'] as const)
                .filter((outcome) => project.stats[outcome] > 0)
                .map((outcome) => (
                  <span key={outcome} class="count">
                    <OutcomeIcon outcome={outcome} decorative />
                    {project.stats[outcome]} <span class="visually-hidden">{outcomeLabel(outcome).toLowerCase()}</span>
                  </span>
                ))}
            </span>
            <span class="project-meta">
              {plural(project.stats.total, 'test')}
              {rate !== null && (
                <>
                  {' · '}
                  <PassRate rate={rate} />
                </>
              )}{' '}
              · {formatDuration(durationMs)} test time
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function CountCell({ value }: { value: number }) {
  return <td class={value === 0 ? 'zero' : undefined}>{value}</td>;
}

const STATUS_OUTCOMES = ['passed', 'failed', 'flaky', 'skipped'] as const;

/** `3 passed, 1 failed`, for labels and tooltips; outcomes without tests left out. */
function countsText(row: DimensionValueCounts): string {
  const parts = STATUS_OUTCOMES.filter((outcome) => row[outcome] > 0).map((outcome) => `${row[outcome]} ${outcome}`);
  return parts.length > 0 ? parts.join(', ') : 'no tests';
}

/** Tag hygiene notes of a value: never merged, only flagged. */
function hygieneNotes(row: DimensionValueCounts): string[] {
  return [
    ...(row.unknown ? ['unknown value'] : []),
    ...(row.caseVariants.length > 0 ? [`likely duplicate of ${row.caseVariants.join(', ')}`] : []),
  ];
}

function HygieneFlags({ row }: { row: DimensionValueCounts }) {
  return (
    <>
      {row.unknown && (
        <span class="hygiene-flag flag-unknown" title="Not among the values declared in the config">
          <AlertIcon />
          unknown value
        </span>
      )}
      {row.caseVariants.length > 0 && (
        <span class="hygiene-flag flag-case" title="Differs from another value only by case. Tags are case-sensitive, so they are counted apart.">
          <AlertIcon />
          likely duplicate of {row.caseVariants.join(', ')}
        </span>
      )}
    </>
  );
}

/** One stacked bar per value (passed / failed / flaky / skipped), the failed and flaky counts with their icons, and the total. */
function DimensionBars({ name, values }: { name: string; values: readonly DimensionValueCounts[] }) {
  return (
    <ul class="dimension-bars">
      {values.map((row) => (
        <li key={row.value} class="dimension-bar-row" data-value={row.value}>
          <span class="dimension-value-cell">
            <DimensionValue name={name} row={row} />
            <HygieneFlags row={row} />
          </span>
          <span class="outcome-bar dimension-bar" role="img" aria-label={`${row.value}: ${countsText(row)}`} title={countsText(row)}>
            {STATUS_OUTCOMES.filter((outcome) => row[outcome] > 0).map((outcome) => (
              <span key={outcome} class={`outcome-bar-part bar-${outcome}`} style={{ flexGrow: row[outcome] }} />
            ))}
          </span>
          <span class="dimension-bar-counts" aria-hidden="true">
            {(['failed', 'flaky'] as const)
              .filter((outcome) => row[outcome] > 0)
              .map((outcome) => (
                <span key={outcome} class="count">
                  <OutcomeIcon outcome={outcome} decorative />
                  {row[outcome]}
                </span>
              ))}
          </span>
          <span class="dimension-total" aria-hidden="true">
            {row.total}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A dimension value: a link to its tests in the Tests view, plain text when no test has it. */
function DimensionValue({ name, row }: { name: string; row: DimensionValueCounts }) {
  if (row.total === 0) return <span class="dimension-value">{row.value}</span>;
  return (
    <a class="dimension-value" href={facetHref(dimensionFacet(name), row.value)} title={`Show the ${plural(row.total, 'test')} with ${name} ${row.value}`}>
      {row.value}
    </a>
  );
}

const WORST_LABELS = { failed: 'with failures', flaky: 'flaky', passed: 'all passed', skipped: 'skipped only', none: 'no tests' } as const;

/**
 * A grid of tiles, one per value, for dimensions with many values: colored by
 * worst status with its icon, problem values first, details on hover and
 * focus. Each tile links to its tests and carries its details as text for
 * screen readers.
 */
/**
 * The one open tile tooltip on the page, and what opened it. The latest
 * interaction wins: hovering a tile replaces a focus tooltip and focusing
 * replaces a hover tooltip, so two never overlap. WCAG 1.4.13: Escape
 * dismisses it without moving focus; it stays open while its tile or the
 * tooltip itself is hovered, or while its tile is focused.
 */
const openTooltip = signal<{ key: string; source: 'hover' | 'focus' } | null>(null);

function closeTooltip(key: string, source: 'hover' | 'focus'): void {
  const current = openTooltip.value;
  if (current?.key === key && current.source === source) openTooltip.value = null;
}

function closeOnEscape(event: KeyboardEvent): void {
  if (event.key === 'Escape' && openTooltip.value) openTooltip.value = null;
}

function DimensionTiles({ name, values }: { name: string; values: readonly DimensionValueCounts[] }) {
  useEffect(() => {
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      if (openTooltip.value?.key.startsWith(`${name}\u0000`)) openTooltip.value = null;
    };
  }, [name]);
  return (
    <>
      <p class="tile-summary">{tileSummary(values)}</p>
      <ul class="dimension-tiles" aria-label={`${name} values`}>
        {tileOrder(values).map((row) => {
          const status = worstStatus(row);
          const notes = hygieneNotes(row);
          const details = [countsText(row), ...notes].join('; ');
          const key = `${name}\u0000${row.value}`;
          const open = openTooltip.value?.key === key;
          const tile = {
            class: `dimension-tile tile-${status}${open ? ' tooltip-open' : ''}`,
            'data-value': row.value,
            'data-status': status,
            onPointerEnter: () => (openTooltip.value = { key, source: 'hover' }),
            onPointerLeave: () => closeTooltip(key, 'hover'),
            onFocus: () => (openTooltip.value = { key, source: 'focus' }),
            onBlur: () => closeTooltip(key, 'focus'),
          };
          const content = (
            <>
              {status === 'none' ? (
                <span class="tile-icon-none" aria-hidden="true" />
              ) : (
                <OutcomeIcon outcome={status} decorative />
              )}
              <span class="tile-value">{row.value}</span>
              {notes.length > 0 && <AlertIcon class="tile-flag" />}
              <span class="visually-hidden">
                : {WORST_LABELS[status]}, {details}
              </span>
              {/* Inside the tile, so the pointer can move onto it without leaving the tile. */}
              <span class="tile-details" aria-hidden="true" hidden={!open}>
                <strong>{row.value}</strong>
                <span>{WORST_LABELS[status]}</span>
                <span>{countsText(row)}</span>
                {notes.map((note) => (
                  <span key={note} class="tile-note">
                    {note}
                  </span>
                ))}
              </span>
            </>
          );
          // A value with tests links to them; one without stays focusable for its details.
          return (
            <li key={row.value}>
              {row.total > 0 ? (
                <a {...tile} href={facetHref(dimensionFacet(name), row.value)}>
                  {content}
                </a>
              ) : (
                <span {...tile} tabIndex={0}>
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/**
 * Outcomes per value of a dimension, with tag hygiene (unknown values and case
 * variants flagged, never merged). Bars up to `DIMENSION_BARS_MAX` values,
 * tiles above; the exact table is one click away.
 */
export function DimensionWidget({ distribution }: { distribution: DimensionDistribution }) {
  const { definition, values, without } = distribution;
  const id = `w-dimension-${definition.name}`;
  const representation = dimensionRepresentation(distribution);
  return (
    <section class="widget widget-dimension" aria-labelledby={id} data-dimension={definition.name} data-representation={representation}>
      <h2 id={id}>{definition.name}</h2>
      <p class="widget-note">
        From {definition.source === 'tag' ? `tags @${definition.key}:…` : `annotations of type "${definition.key}"`}
        {without > 0 && ` · ${plural(without, 'test')} without a value`}
      </p>
      {representation === 'bars' ? <DimensionBars name={definition.name} values={values} /> : <DimensionTiles name={definition.name} values={values} />}
      <details class="dimension-table">
        <summary>
          <ChevronIcon class="chevron" />
          Table
        </summary>
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Value</th>
              {STATUS_OUTCOMES.map((outcome) => (
                <th key={outcome} scope="col">
                  <OutcomeIcon outcome={outcome} labelled />
                </th>
              ))}
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {values.map((row) => (
              <tr key={row.value}>
                <th scope="row">
                  <DimensionValue name={definition.name} row={row} />
                  <HygieneFlags row={row} />
                </th>
                {STATUS_OUTCOMES.map((outcome) => (
                  <CountCell key={outcome} value={row[outcome]} />
                ))}
                <CountCell value={row.total} />
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      {definition.values === null && (
        <p class="widget-hint">
          No expected values are configured, so typos cannot be flagged as unknown. Declare them with <code>values</code> in{' '}
          <a href={DIMENSIONS_DOCS} target="_blank" rel="noopener noreferrer">
            the dimension definition
          </a>
          .
        </p>
      )}
    </section>
  );
}

export function TestLine({ test, children, aside }: { test: TestCase; children?: ComponentChildren; aside?: ComponentChildren }) {
  return (
    <div class="test-line">
      <OutcomeIcon outcome={test.outcome} />
      <span class="test-text">
        <a href={testHref(test)}>{test.title}</a>
        <span class="test-where">
          {projectLabel(test.project)} · {test.file}
          {test.repeatEachIndex > 0 && ` · repeat ${test.repeatEachIndex}`}
        </span>
        {children}
      </span>
      {aside}
    </div>
  );
}

function testKey(test: TestCase): string {
  return `${test.id}/${test.repeatEachIndex}`;
}

export function SlowestWidget({ tests }: { tests: readonly TestCase[] }) {
  return (
    <Widget id="w-slowest" class="widget-slowest" title="Slowest tests" note="Total duration, retries included.">
      <ol class="widget-list">
        {tests.map((test) => (
          <li key={testKey(test)}>
            <TestLine
              test={test}
              aside={<span class="duration">{formatDuration(test.durationMs)}</span>}
            >
              {test.attempts.length > 1 && <span class="test-where">{plural(test.attempts.length, 'attempt')}</span>}
            </TestLine>
          </li>
        ))}
      </ol>
    </Widget>
  );
}

export function SkippedWidget({ tests }: { tests: readonly SkippedTest[] }) {
  return (
    <Widget id="w-skipped" class="widget-skipped" title="Skipped tests">
      <ul class="widget-list">
        {tests.map(({ test, reason }) => (
          <li key={testKey(test)}>
            <TestLine test={test}>
              <SkipReasonText reason={reason} class="test-where" />
            </TestLine>
          </li>
        ))}
      </ul>
    </Widget>
  );
}

export function FlakyWidget({ tests, colors }: { tests: readonly FlakyTest[]; colors: Colors }) {
  return (
    <Widget id="w-flaky" class="widget-flaky" title="Flaky tests" note="Failed, then passed on a retry: the error of the failing attempt.">
      <ul class="widget-list">
        {tests.map(({ test, error }) => (
          <li key={testKey(test)}>
            <TestLine test={test}>
              {error && (
                <span class="flaky-error">
                  {error.category && <CategoryBadge name={error.category} color={colors.get(error.category)} />}
                  <code>{errorHeadline(error.message)}</code>
                </span>
              )}
            </TestLine>
          </li>
        ))}
      </ul>
    </Widget>
  );
}
