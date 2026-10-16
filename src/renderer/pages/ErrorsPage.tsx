import { useEffect, useMemo, useRef } from 'preact/hooks';
import type { LoupeReport } from '../../schema/v1.js';
import { categoryColorMap } from '../categoryColors.js';
import { CategoryDetails, GroupList, RunErrorItem, Widget } from '../components/widgets.js';
import { categoryCounts, rankGroups, type ErrorGroup } from '../dashboard.js';
import { plural } from '../format.js';

/**
 * Errors (`#/errors`): run errors first, then every error group (most failed
 * tests first, then most flaky), then the categories in detail.
 * `#/errors/category/<name>` opens that category and scrolls to it.
 */
export function ErrorsPage({ report, groups, category }: { report: LoupeReport; groups: readonly ErrorGroup[]; category?: string | undefined }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (category === undefined) return;
    const target = [...(root.current?.querySelectorAll<HTMLElement>('[data-category]') ?? [])].find(
      (element) => element.dataset['category'] === category,
    );
    target?.scrollIntoView({ block: 'start' });
    target?.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
  }, [category]);
  const ranked = useMemo(() => rankGroups(groups), [groups]);
  const categories = useMemo(() => categoryCounts(report, groups), [report, groups]);
  const colors = useMemo(() => categoryColorMap(report.categories), [report]);
  const { errors } = report.run;

  return (
    <div class="page view view-errors" ref={root}>
      <h1>Errors</h1>
      {errors.length === 0 && groups.length === 0 && <p class="muted">No errors in this run.</p>}
      {errors.length > 0 && (
        <Widget
          id="w-run-errors"
          class="widget-run-error-list"
          title={plural(errors.length, 'run error')}
          note="Reported outside any test: a file that failed to load, a global setup or teardown, a worker teardown. Playwright may have run fewer tests because of them."
        >
          <ol class="run-errors">
            {errors.map((error, index) => (
              <RunErrorItem key={index} error={error} color={error.category ? colors.get(error.category) : undefined} />
            ))}
          </ol>
        </Widget>
      )}
      {ranked.length > 0 && (
        <Widget
          id="w-groups"
          class="widget-groups"
          title={plural(ranked.length, 'error group')}
          note="Errors grouped by normalized signature: most failed tests first, then most flaky tests."
        >
          <GroupList groups={ranked} colors={colors} />
        </Widget>
      )}
      {categories.length > 0 && (
        <Widget
          id="w-categories"
          class="widget-categories"
          title="Error categories"
          note="Failing tests per category; flaky tests count, and a test can be in several categories."
        >
          <CategoryDetails key={category} categories={categories} colors={colors} open={category} />
        </Widget>
      )}
    </div>
  );
}
