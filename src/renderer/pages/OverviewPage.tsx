import { useEffect, useMemo } from 'preact/hooks';
import type { LoupeReport, TestCase } from '../../schema/v1.js';
import { categoryColorMap } from '../categoryColors.js';
import { RunDetails, focusRunDetails } from '../components/RunDetails.js';
import { CategoryBars, FailurePointsWidget, ProjectCards, RerunFailed, RunErrorsSummary, Verdict, Widget } from '../components/widgets.js';
import { categoryCounts, projectSummaries, splitAfterTimeout, type ErrorGroup } from '../dashboard.js';
import { failurePoints } from '../failure-points/points.js';
import { plural } from '../format.js';
import { hrefTo } from '../navigation.js';
import { foldedMention } from '../secondary.js';

/**
 * Overview (`#/`): the verdict, run errors when there are any, the common
 * failure points when there are any (each opening its tests in the Tests
 * view), the error categories in short (each opening its tests too), then
 * the projects, then the run details. The verdict offers the rerun command
 * of the failed tests (of the current filter). Error groups live in the
 * errors view only. Widgets with nothing to show are left out, except the
 * verdict and the run details. `#/run-details` opens it on the run details.
 */
export function OverviewPage({
  report,
  groups,
  matched,
  section,
}: {
  report: LoupeReport;
  groups: readonly ErrorGroup[];
  matched: readonly TestCase[];
  section?: 'run-details' | undefined;
}) {
  useEffect(() => {
    if (section === 'run-details') focusRunDetails();
  }, [section]);
  const data = useMemo(
    () => ({ categories: categoryCounts(report, groups), projects: projectSummaries(report), points: failurePoints(report).points }),
    [report, groups],
  );
  const colors = useMemo(() => categoryColorMap(report.categories), [report]);
  const { visible, folded } = splitAfterTimeout(groups);

  return (
    <div class="page view view-overview">
      <h1>Overview</h1>
      <Verdict report={report}>
        <RerunFailed tests={matched} action="Rerun failed tests" />
      </Verdict>
      {report.run.errors.length > 0 && <RunErrorsSummary errors={report.run.errors} />}
      {data.points.length > 0 && <FailurePointsWidget points={data.points} colors={colors} categories={report.categories} />}
      {data.categories.length > 0 && (
        <Widget
          id="w-categories"
          class="widget-categories"
          title="Error categories"
          note={
            <>
              Failing tests per category. <a href={hrefTo({ page: 'errors' })}>All {plural(visible.length, 'error group')}</a>
              {folded.length > 0 && ` · ${foldedMention(folded.length)}`}
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
