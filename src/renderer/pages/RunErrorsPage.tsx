import type { LoupeReport, RunError } from '../../schema/v1.js';
import { CategoryBadge } from '../components/CategoryBadge.js';
import { plural } from '../format.js';

function RunErrorItem({ error, color }: { error: RunError; color: string | undefined }) {
  const location = error.location ? `${error.location.file}:${error.location.line}:${error.location.column}` : null;
  return (
    <li class="run-error">
      <div class="run-error-meta">
        {error.category && (
          <CategoryBadge name={error.category} color={color} />
        )}
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

/** Errors outside any test: load errors, global setup / teardown, worker teardown. */
export function RunErrorsPage({ report }: { report: LoupeReport }) {
  const { errors } = report.run;
  const colors = new Map(report.categories.map((category) => [category.name, category.color]));
  return (
    <div class="page">
      <h1>Run errors</h1>
      {errors.length === 0 ? (
        <p>No error outside tests in this run.</p>
      ) : (
        <>
          <p class="muted">
            {plural(errors.length, 'error')} reported outside any test: a file that failed to load, a global setup or teardown,
            a worker teardown. Playwright may have run fewer tests because of them.
          </p>
          <ol class="run-errors">
            {errors.map((error, index) => (
              <RunErrorItem key={index} error={error} color={error.category ? colors.get(error.category) : undefined} />
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
