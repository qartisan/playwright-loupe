import type { TestCase } from '../../schema/v1.js';
import { OutcomeIcon } from '../components/icons.js';
import { UNNAMED_PROJECT } from '../tree.js';
import { NotFoundPage } from './NotFoundPage.js';

/** Placeholder: title and status only; the test detail comes later. */
export function TestPage({ test }: { test: TestCase | undefined }) {
  if (!test) return <NotFoundPage message="No test with this id in this report." />;
  const path = [test.project || UNNAMED_PROJECT, test.file, ...test.suitePath];
  return (
    <div class="page">
      <p class="breadcrumb">
        {path.map((part, index) => (
          <span key={index} class="label-part">
            {part}
          </span>
        ))}
      </p>
      <h1 class="test-title">
        {test.title}
        {test.repeatEachIndex > 0 && <span class="row-note"> repeat {test.repeatEachIndex}</span>}
      </h1>
      <OutcomeIcon outcome={test.outcome} labelled />
    </div>
  );
}
