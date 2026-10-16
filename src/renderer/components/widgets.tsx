import type { ComponentChildren } from 'preact';
import type { LoupeReport, RunError, TestCase } from '../../schema/v1.js';
import { categoryStyle } from '../categoryColors.js';
import {
  errorHeadline,
  groupSummary,
  outcomeShares,
  passRate,
  verdict,
  type CategoryCount,
  type DimensionDistribution,
  type ErrorGroup,
  type FlakyTest,
  type ProjectSummary,
  type SkippedTest,
} from '../dashboard.js';
import { formatDuration, plural } from '../format.js';
import { revealInSidebar } from '../layout.js';
import { hrefTo } from '../navigation.js';
import { UNNAMED_PROJECT, projectKey } from '../tree.js';
import { CategoryBadge } from './CategoryBadge.js';
import { GroupSplit } from './GroupSplit.js';
import { AlertIcon, ChevronIcon, OutcomeIcon, outcomeLabel } from './icons.js';

/** Widgets shared by the overview, errors and suite health views. */

export type Colors = ReadonlyMap<string, string>;

/** Where the dimension options are documented, for the hint shown when a dimension declares no values. */
const DIMENSIONS_DOCS = 'https://github.com/qartisan/playwright-loupe/blob/main/docs/config.md#dimensions';

export function testHref(test: TestCase): string {
  return hrefTo({ page: 'test', id: test.id, repeatEachIndex: test.repeatEachIndex });
}

export function projectLabel(name: string): string {
  return name || UNNAMED_PROJECT;
}

function percent(share: number): string {
  const value = share * 100;
  return `${value > 0 && value < 1 ? '<1' : Math.round(value)}%`;
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
export function Verdict({ report }: { report: LoupeReport }) {
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
              <strong>{percent(rate)}</strong> passed ·{' '}
            </>
          )}
          {plural(stats.total, 'test')} in <strong>{formatDuration(report.run.durationMs)}</strong>
        </p>
      </div>
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
            {shares.map(({ outcome: key, share }) => (
              <li key={key}>
                <OutcomeIcon outcome={key} decorative />
                {outcomeLabel(key)} {percent(share)}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
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
      {error.snippet && <pre class="code-snippet">{error.snippet}</pre>}
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
 */
export function GroupRow({ group, colors }: { group: ErrorGroup; colors: Colors }) {
  const { headline, firstTest, others } = groupSummary(group);
  return (
    <a class="group-row" href={hrefTo({ page: 'group', signature: group.signature })}>
      <span class="group-row-head">
        <CategoryBadge name={group.category} color={colors.get(group.category)} />
        <GroupSplit group={group} />
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

export function GroupList({ groups, colors }: { groups: readonly ErrorGroup[]; colors: Colors }) {
  return (
    <ol class="widget-list group-list">
      {groups.map((group) => (
        <li key={group.signature}>
          <GroupRow group={group} colors={colors} />
        </li>
      ))}
    </ol>
  );
}

/** Failing tests per category as bars, linking to the errors view. */
export function CategoryBars({ categories, colors }: { categories: readonly CategoryCount[]; colors: Colors }) {
  const max = Math.max(...categories.map((category) => category.tests), 1);
  return (
    <ul class="widget-list category-bars">
      {categories.map((category) => (
        <li key={category.name}>
          <a class="category-bar-row" href={hrefTo({ page: 'errors' })}>
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

/** Categories with their group and test counts, each expanding to its groups. */
export function CategoryDetails({ categories, colors }: { categories: readonly CategoryCount[]; colors: Colors }) {
  return (
    <ul class="widget-list category-list">
      {categories.map((category) => (
        <li key={category.name}>
          <details>
            <summary>
              <ChevronIcon class="chevron" />
              <CategoryBadge name={category.name} color={colors.get(category.name)} />
              <span class="muted">{plural(category.groups.length, 'error group')}</span>
              <span class="group-count">{plural(category.tests, 'test')}</span>
            </summary>
            <GroupList groups={category.groups} colors={colors} />
          </details>
        </li>
      ))}
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
              {rate !== null && ` · ${percent(rate)} passed`} · {formatDuration(durationMs)} test time
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

/** Outcomes per value of a dimension, with tag hygiene: unknown values and case variants are flagged, never merged. */
export function DimensionWidget({ distribution }: { distribution: DimensionDistribution }) {
  const { definition, values, without } = distribution;
  const id = `w-dimension-${definition.name}`;
  return (
    <section class="widget widget-dimension" aria-labelledby={id} data-dimension={definition.name}>
      <h2 id={id}>{definition.name}</h2>
      <p class="widget-note">
        From {definition.source === 'tag' ? `tags @${definition.key}:…` : `annotations of type "${definition.key}"`}
        {without > 0 && ` · ${plural(without, 'test')} without a value`}
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th scope="col">Value</th>
            {(['passed', 'failed', 'flaky'] as const).map((outcome) => (
              <th key={outcome} scope="col">
                <OutcomeIcon outcome={outcome} labelled />
              </th>
            ))}
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {values.map((row) => (
            <tr key={row.value} class={row.unknown || row.caseVariants.length > 0 ? 'flagged' : undefined}>
              <th scope="row">
                <span class="dimension-value">{row.value}</span>
                {row.unknown && (
                  <span class="hygiene-flag flag-unknown" title="Not among the values declared in the config">
                    <AlertIcon />
                    unknown value
                  </span>
                )}
                {row.caseVariants.length > 0 && (
                  <span
                    class="hygiene-flag flag-case"
                    title="Differs from another value only by case. Tags are case-sensitive, so they are counted apart."
                  >
                    <AlertIcon />
                    likely duplicate of {row.caseVariants.join(', ')}
                  </span>
                )}
              </th>
              <CountCell value={row.passed} />
              <CountCell value={row.failed} />
              <CountCell value={row.flaky} />
              <CountCell value={row.total} />
            </tr>
          ))}
        </tbody>
      </table>
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
        {tests.map(({ test, kind, reason }) => (
          <li key={testKey(test)}>
            <TestLine test={test}>
              <span class="test-where">
                {kind === 'fixme' && <span class="skip-kind">fixme</span>} {reason ?? <span class="muted">No reason given</span>}
              </span>
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
