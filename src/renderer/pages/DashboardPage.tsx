import type { LoupeReport } from '../../schema/v1.js';
import { plural } from '../format.js';
import { hrefTo } from '../navigation.js';

/** Placeholder: the dashboard widgets come later. */
export function DashboardPage({ report }: { report: LoupeReport }) {
  const projects = new Set(report.tests.map((test) => test.project)).size;
  const runErrors = report.run.errors.length;
  return (
    <div class="page">
      <h1>Dashboard</h1>
      <p>
        {plural(report.run.stats.total, 'test')} in {plural(projects, 'project')}.
        {runErrors > 0 && (
          <>
            {' '}
            <a href={hrefTo({ page: 'run-errors' })}>{plural(runErrors, 'run error')}</a> outside tests.
          </>
        )}
      </p>
      <p class="muted">Dashboard widgets are not available yet. Pick a test in the sidebar.</p>
    </div>
  );
}
