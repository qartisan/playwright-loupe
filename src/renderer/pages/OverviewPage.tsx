import { useMemo } from 'preact/hooks';
import type { LoupeReport } from '../../schema/v1.js';
import { categoryColorMap } from '../categoryColors.js';
import { CategoryBars, GroupList, ProjectCards, RunErrorsSummary, Verdict, Widget } from '../components/widgets.js';
import { categoryCounts, lookAtFirst, projectSummaries, type ErrorGroup } from '../dashboard.js';
import { hrefTo } from '../navigation.js';

/**
 * Overview (`#/`): the verdict, run errors when there are any, the errors to
 * look at first next to the categories, then the projects. Widgets with
 * nothing to show are left out, except the verdict.
 */
export function OverviewPage({ report, groups }: { report: LoupeReport; groups: readonly ErrorGroup[] }) {
  const data = useMemo(
    () => ({ top: lookAtFirst(groups), categories: categoryCounts(report, groups), projects: projectSummaries(report) }),
    [report, groups],
  );
  const colors = useMemo(() => categoryColorMap(report.categories), [report]);

  return (
    <div class="page view view-overview">
      <h1>Overview</h1>
      <Verdict report={report} />
      {report.run.errors.length > 0 && <RunErrorsSummary errors={report.run.errors} />}
      {data.top.length > 0 && (
        <div class="overview-row">
          <Widget
            id="w-look"
            class="widget-look-at-first"
            title="Look at first"
            note={
              <>
                The errors failing the most tests, then making the most tests flaky.{' '}
                {groups.length > data.top.length && <a href={hrefTo({ page: 'errors' })}>All {groups.length} error groups</a>}
              </>
            }
          >
            <GroupList groups={data.top} colors={colors} />
          </Widget>
          <Widget id="w-categories" class="widget-categories" title="Error categories" note="Failing tests per category.">
            <CategoryBars categories={data.categories} colors={colors} />
          </Widget>
        </div>
      )}
      {data.projects.length > 0 && (
        <Widget id="w-projects" class="widget-projects" title="Projects">
          <ProjectCards projects={data.projects} />
        </Widget>
      )}
    </div>
  );
}
