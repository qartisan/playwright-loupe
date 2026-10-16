import type { ComponentChildren } from 'preact';
import { useMemo } from 'preact/hooks';
import type { LoupeReport, TestCase } from '../../schema/v1.js';
import { OUTCOMES } from '../../schema/v1.js';
import { categoryColorMap } from '../categoryColors.js';
import { CategoryBadge } from '../components/CategoryBadge.js';
import { GroupSplit } from '../components/GroupSplit.js';
import { AlertIcon, ChevronIcon, OutcomeIcon, outcomeLabel } from '../components/icons.js';
import {
  categoryCounts,
  dimensionDistributions,
  firstLine,
  lookAtFirst,
  projectSummaries,
  skippedTests,
  slowestTests,
  verdict,
  type CategoryCount,
  type DimensionDistribution,
  type ErrorGroup,
  type ProjectSummary,
  type SkippedTest,
} from '../dashboard.js';
import { formatDuration, plural } from '../format.js';
import { revealInSidebar } from '../layout.js';
import { hrefTo } from '../navigation.js';
import { UNNAMED_PROJECT, projectKey } from '../tree.js';

/**
 * The dashboard: a list of widgets, in a fixed order. Run errors, when there
 * are any, come first, before the verdict. A widget with nothing to show is
 * left out, except the verdict.
 */
export function DashboardPage({ report, groups }: { report: LoupeReport; groups: ErrorGroup[] }) {
  const data = useMemo(
    () => ({
      top: lookAtFirst(groups),
      categories: categoryCounts(report, groups),
      projects: projectSummaries(report),
      dimensions: dimensionDistributions(report),
      slowest: slowestTests(report),
      skipped: skippedTests(report),
    }),
    [report, groups],
  );
  const colors = useMemo(() => categoryColorMap(report.categories), [report]);

  return (
    <div class="page">
      <h1>Dashboard</h1>
      <div class="widgets">
        {report.run.errors.length > 0 && <RunErrorsWidget report={report} />}
        <VerdictWidget report={report} />
        {data.top.length > 0 && <LookAtFirstWidget groups={data.top} colors={colors} />}
        {data.categories.length > 0 && <CategoriesWidget categories={data.categories} colors={colors} />}
        {data.projects.length > 0 && <ProjectsWidget projects={data.projects} />}
        {data.dimensions.map((distribution) => (
          <DimensionWidget key={distribution.definition.name} distribution={distribution} />
        ))}
        {data.slowest.length > 0 && <SlowestWidget tests={data.slowest} />}
        {data.skipped.length > 0 && <SkippedWidget tests={data.skipped} />}
      </div>
    </div>
  );
}

function testHref(test: TestCase): string {
  return hrefTo({ page: 'test', id: test.id, repeatEachIndex: test.repeatEachIndex });
}

function projectLabel(name: string): string {
  return name || UNNAMED_PROJECT;
}

function VerdictWidget({ report }: { report: LoupeReport }) {
  const outcome = verdict(report);
  const { stats } = report.run;
  return (
    <section class="widget widget-wide widget-verdict" aria-labelledby="w-verdict">
      <h2 id="w-verdict" class="visually-hidden">
        Verdict
      </h2>
      <div class="verdict">
        <p class={`verdict-outcome outcome-${outcome}`} data-verdict={outcome}>
          <OutcomeIcon outcome={outcome} decorative />
          <span>{outcomeLabel(outcome)}</span>
        </p>
        <ul class="verdict-counts" aria-label="Test counts">
          {OUTCOMES.map((key) => (
            <li key={key}>
              <OutcomeIcon outcome={key} decorative />
              <strong>{stats[key]}</strong> <span class="muted">{outcomeLabel(key).toLowerCase()}</span>
            </li>
          ))}
        </ul>
        <p class="verdict-meta">
          <strong>{plural(stats.total, 'test')}</strong> in <strong>{formatDuration(report.run.durationMs)}</strong>
        </p>
      </div>
    </section>
  );
}

function RunErrorsWidget({ report }: { report: LoupeReport }) {
  const { errors } = report.run;
  return (
    <section class="widget widget-wide widget-run-errors" aria-labelledby="w-run-errors">
      <h2 id="w-run-errors">
        <AlertIcon />
        {plural(errors.length, 'error')} outside tests
      </h2>
      <p class="widget-note">A file that failed to load, a global setup or teardown, a worker teardown: Playwright may have run fewer tests.</p>
      <ul class="widget-list">
        {errors.slice(0, 3).map((error, index) => (
          <li key={index}>
            <code>{firstLine(error.message)}</code>
          </li>
        ))}
      </ul>
      <p class="widget-more">
        <a href={hrefTo({ page: 'run-errors' })}>See the run errors</a>
      </p>
    </section>
  );
}

function GroupLink({ group, colors }: { group: ErrorGroup; colors: Map<string, string> }) {
  return (
    <a class="group-link" href={hrefTo({ page: 'group', signature: group.signature })}>
      <CategoryBadge name={group.category} color={colors.get(group.category)} />
      <code class="group-signature" title="Error signature">
        {group.signature}
      </code>
      <GroupSplit group={group} />
      <code class="group-message">{firstLine(group.message)}</code>
    </a>
  );
}

function LookAtFirstWidget({ groups, colors }: { groups: ErrorGroup[]; colors: Map<string, string> }) {
  return (
    <section class="widget widget-wide widget-look-at-first" aria-labelledby="w-look">
      <h2 id="w-look">Look at first</h2>
      <p class="widget-note">The errors failing the most tests, then making the most tests flaky.</p>
      <ol class="widget-list">
        {groups.map((group) => (
          <li key={group.signature}>
            <GroupLink group={group} colors={colors} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function CategoriesWidget({ categories, colors }: { categories: CategoryCount[]; colors: Map<string, string> }) {
  return (
    <section class="widget widget-categories" aria-labelledby="w-categories">
      <h2 id="w-categories">Error categories</h2>
      <p class="widget-note">Failing tests per category; flaky tests count, and a test can be in several categories.</p>
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
              <ul class="widget-list">
                {category.groups.map((group) => (
                  <li key={group.signature}>
                    <GroupLink group={group} colors={colors} />
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProjectsWidget({ projects }: { projects: ProjectSummary[] }) {
  return (
    <section class="widget widget-wide widget-projects" aria-labelledby="w-projects">
      <h2 id="w-projects">Projects</h2>
      <ul class="project-cards">
        {projects.map(({ project, passRate, durationMs }) => (
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
                {OUTCOMES.filter((outcome) => project.stats[outcome] > 0).map((outcome) => (
                  <span key={outcome} class="count">
                    <OutcomeIcon outcome={outcome} decorative />
                    {project.stats[outcome]} <span class="visually-hidden">{outcomeLabel(outcome).toLowerCase()}</span>
                  </span>
                ))}
              </span>
              <span class="project-meta">
                {plural(project.stats.total, 'test')}
                {passRate !== null && ` · ${Math.round(passRate * 100)}% passed`} · {formatDuration(durationMs)} test time
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CountCell({ value }: { value: number }) {
  return <td class={value === 0 ? 'zero' : undefined}>{value}</td>;
}

function DimensionWidget({ distribution }: { distribution: DimensionDistribution }) {
  const { definition, values, without } = distribution;
  const id = `w-dimension-${definition.name}`;
  if (values.length === 0) return null;
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
            <tr key={row.value} class={row.unknown ? 'unknown' : undefined}>
              <th scope="row">
                {row.value}
                {row.unknown && (
                  <span class="unknown-value" title="Not among the values declared in the config">
                    <AlertIcon />
                    not declared
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
    </section>
  );
}

function TestLine({ test, children }: { test: TestCase; children?: ComponentChildren }) {
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
    </div>
  );
}

function SlowestWidget({ tests }: { tests: TestCase[] }) {
  return (
    <section class="widget widget-slowest" aria-labelledby="w-slowest">
      <h2 id="w-slowest">Slowest tests</h2>
      <p class="widget-note">Total duration, retries included.</p>
      <ol class="widget-list">
        {tests.map((test) => (
          <li key={`${test.id}/${test.repeatEachIndex}`} class="test-line">
            <OutcomeIcon outcome={test.outcome} />
            <span class="test-text">
              <a href={testHref(test)}>{test.title}</a>
              <span class="test-where">
                {projectLabel(test.project)} · {test.file}
                {test.attempts.length > 1 && ` · ${plural(test.attempts.length, 'attempt')}`}
              </span>
            </span>
            <span class="duration">{formatDuration(test.durationMs)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function SkippedWidget({ tests }: { tests: SkippedTest[] }) {
  return (
    <section class="widget widget-skipped" aria-labelledby="w-skipped">
      <h2 id="w-skipped">Skipped tests</h2>
      <ul class="widget-list">
        {tests.map(({ test, kind, reason }) => (
          <li key={`${test.id}/${test.repeatEachIndex}`}>
            <TestLine test={test}>
              <span class="test-where">
                {kind === 'fixme' && <span class="skip-kind">fixme</span>} {reason ?? <span class="muted">No reason given</span>}
              </span>
            </TestLine>
          </li>
        ))}
      </ul>
    </section>
  );
}
