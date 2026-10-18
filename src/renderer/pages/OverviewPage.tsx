import { useMemo } from 'preact/hooks';
import type { LoupeReport, TestCase } from '../../schema/v1.js';
import { categoryColorMap } from '../categoryColors.js';
import { RunDetails } from '../components/RunDetails.js';
import { CategoryBars, ProjectCards, RerunFailed, RunErrorsSummary, Verdict, Widget } from '../components/widgets.js';
import { categoryCounts, projectSummaries, type ErrorGroup } from '../dashboard.js';
import { plural } from '../format.js';
import { hrefTo } from '../navigation.js';

/**
 * Overview (`#/`): the verdict, run errors when there are any, the error
 * categories in short (each opening its category in the errors view), then
 * the projects, then the run details. The verdict offers the rerun command
 * of the failed tests (of the current filter). Error groups live in the
 * errors view only. Widgets with nothing to show are left out, except the
 * verdict and the run details.
 */
export function OverviewPage({ report, groups, matched }: { report: LoupeReport; groups: readonly ErrorGroup[]; matched: readonly TestCase[] }) {
  const data = useMemo(() => ({ categories: categoryCounts(report, groups), projects: projectSummaries(report) }), [report, groups]);
  const colors = useMemo(() => categoryColorMap(report.categories), [report]);

  return (
    <div class="page view view-overview">
      <h1>Overview</h1>
      <Verdict report={report}>
        <RerunFailed tests={matched} action="Rerun failed tests" />
      </Verdict>
      {report.run.errors.length > 0 && <RunErrorsSummary errors={report.run.errors} />}
      {data.categories.length > 0 && (
        <Widget
          id="w-categories"
          class="widget-categories"
          title="Error categories"
          note={
            <>
              Failing tests per category. <a href={hrefTo({ page: 'errors' })}>All {plural(groups.length, 'error group')}</a>
            </>
          }
        >
          <CategoryBars categories={data.categories} colors={colors} />
        </Widget>
      )}
      {data.projects.length > 0 && (
        <Widget id="w-projects" class="widget-projects" title="Projects">
          <ProjectCards projects={data.projects} />
        </Widget>
      )}
      <RunDetails report={report} />
    </div>
  );
}
