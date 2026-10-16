import type { LoupeReport } from '../../schema/v1.js';
import { categoryColorMap } from '../categoryColors.js';
import { CategoryBadge } from '../components/CategoryBadge.js';
import { GroupSplit } from '../components/GroupSplit.js';
import { OutcomeIcon } from '../components/icons.js';
import type { ErrorGroup } from '../dashboard.js';
import { plural } from '../format.js';
import { hrefTo } from '../navigation.js';
import { UNNAMED_PROJECT } from '../tree.js';
import { NotFoundPage } from './NotFoundPage.js';

/** Attempt 0 is the first run, then retries. */
function attemptLabel(index: number): string {
  return index === 0 ? 'first run' : `retry ${index}`;
}

/** An error group: the tests failing with one normalized error signature. */
export function GroupPage({ report, group }: { report: LoupeReport; group: ErrorGroup | undefined }) {
  if (!group) return <NotFoundPage message="No error group with this signature in this report." />;
  const color = categoryColorMap(report.categories).get(group.category);
  return (
    <div class="page group-page">
      <p class="breadcrumb">Error group</p>
      <h1>{plural(group.tests.length, 'test')} failing with this error</h1>
      <dl class="group-meta">
        <div>
          <dt>Category</dt>
          <dd>
            <CategoryBadge name={group.category} color={color} />
          </dd>
        </div>
        <div>
          <dt>Tests</dt>
          <dd>
            <GroupSplit group={group} />
          </dd>
        </div>
        <div>
          <dt>Signature</dt>
          <dd>
            <code>{group.signature}</code>
          </dd>
        </div>
      </dl>
      <h2>Sample message</h2>
      <pre class="message group-sample">{group.message}</pre>
      <h2>Affected tests</h2>
      <table class="affected-tests">
        <thead>
          <tr>
            <th scope="col">Test</th>
            <th scope="col">Project</th>
            <th scope="col">File</th>
            <th scope="col">Error in</th>
          </tr>
        </thead>
        <tbody>
          {group.tests.map(({ test, attempts }) => (
            <tr key={`${test.id}/${test.repeatEachIndex}`}>
              <td>
                <span class="test-cell">
                  <OutcomeIcon outcome={test.outcome} />
                  <a href={hrefTo({ page: 'test', id: test.id, repeatEachIndex: test.repeatEachIndex })}>
                    {[...test.suitePath, test.title].join(' › ')}
                  </a>
                  {test.repeatEachIndex > 0 && <span class="row-note">repeat {test.repeatEachIndex}</span>}
                </span>
              </td>
              <td>{test.project || UNNAMED_PROJECT}</td>
              <td>
                <code>
                  {test.file}:{test.line}
                </code>
              </td>
              <td>
                {attempts.map(attemptLabel).join(', ')}
                <span class="muted"> of {plural(test.attempts.length, 'attempt')}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
