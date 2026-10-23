import type { LoupeReport } from '../../schema/v1.js';
import { categoryColorMap } from '../categoryColors.js';
import { CategoryBadge } from '../components/CategoryBadge.js';
import { GroupSplit } from '../components/GroupSplit.js';
import { OutcomeIcon } from '../components/icons.js';
import { Pager } from '../components/Pager.js';
import type { ErrorGroup } from '../dashboard.js';
import { groupNavigation } from '../detail/sequence.js';
import { filters } from '../filters/store.js';
import { plural } from '../format.js';
import { hrefTo, navigate } from '../navigation.js';
import { useShortcuts } from '../shortcuts.js';
import { UNNAMED_PROJECT } from '../tree.js';
import { NotFoundPage } from './NotFoundPage.js';

/** Attempt 0 is the first run, then retries. */
function attemptLabel(index: number): string {
  return index === 0 ? 'first run' : `retry ${index}`;
}

/**
 * An error group: the tests failing with one normalized error signature.
 * Previous / next follow the Errors view's order; with a category filter
 * that includes this group (a link from a category), only that category's
 * groups.
 */
export function GroupPage({ report, groups, group }: { report: LoupeReport; groups: readonly ErrorGroup[]; group: ErrorGroup | undefined }) {
  const categories = filters.value.facets.category ?? [];
  const sequence = group ? groupNavigation(groups, group, categories) : null;
  const goTo = (target: ErrorGroup | null | undefined) => (target ? () => navigate({ page: 'group', signature: target.signature }) : null);
  useShortcuts({ n: goTo(sequence?.next), p: goTo(sequence?.previous) });

  if (!group || !sequence) return <NotFoundPage message="No error group with this signature in this report." />;
  const color = categoryColorMap(report.categories).get(group.category);
  return (
    <div class="page group-page">
      <Pager
        label={sequence.restricted ? `Error groups in ${categories.join(', ')}` : 'Error groups'}
        position={sequence.position}
        total={sequence.total}
        outside=""
        previous={goTo(sequence.previous)}
        next={goTo(sequence.next)}
        previousLabel="Previous group"
        nextLabel="Next group"
        keys={['p', 'n']}
      />
      <p class="breadcrumb">{sequence.restricted ? `Error group · ${categories.join(', ')}` : 'Error group'}</p>
      <h1>{plural(group.tests.length, 'test')} failing with this error</h1>
      {group.afterTimeout && (
        <p class="group-note">Only seen after a test timeout: raised by the action still running when the test timed out, never as the first error of an attempt.</p>
      )}
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
        <caption class="visually-hidden">Affected tests</caption>
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
