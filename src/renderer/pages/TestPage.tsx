import { useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import type { RendererSettings } from '../../core/inject.js';
import type { Annotation, Attempt, LoupeReport, TestCase } from '../../schema/v1.js';
import { mergeAnnotations } from '../../shared/annotations.js';
import { categoryColorMap } from '../categoryColors.js';
import { CategoryBadge } from '../components/CategoryBadge.js';
import { CopyButton } from '../components/CopyButton.js';
import { OutcomeIcon } from '../components/icons.js';
import { Pager } from '../components/Pager.js';
import { Attachments } from '../components/Media.js';
import { ErrorCard, OutputBlock, StepTree } from '../components/TestDetail.js';
import { RerunButton, projectLabel } from '../components/widgets.js';
import type { ErrorGroup } from '../dashboard.js';
import { buildAiPrompt } from '../detail/aiPrompt.js';
import { attemptLabel, selectAttempt } from '../detail/attempts.js';
import { parseDetailParams, serializeDetailParams, type DetailParams } from '../detail/params.js';
import { fileRerun } from '../detail/rerun.js';
import { neighbors } from '../detail/sequence.js';
import { shownCategories } from '../filters/match.js';
import { setDetailQuery } from '../filters/store.js';
import { isSecondaryError } from '../secondary.js';
import { NOT_RUN_EXPLANATION, skipLabel, skipReason } from '../skip.js';
import { formatDuration, plural } from '../format.js';
import { currentLocation, navigate } from '../navigation.js';
import { useShortcuts } from '../shortcuts.js';
import { NotFoundPage } from './NotFoundPage.js';

const ATTEMPT_STATUS_OUTCOME = { passed: 'passed', failed: 'failed', timedOut: 'failed', interrupted: 'failed', skipped: 'skipped' } as const;
const ATTEMPT_STATUS_LABELS = { passed: 'Passed', failed: 'Failed', timedOut: 'Timed out', interrupted: 'Interrupted', skipped: 'Skipped' } as const;

function testRoute(test: TestCase) {
  return { page: 'test', id: test.id, repeatEachIndex: test.repeatEachIndex } as const;
}

function annotationText({ type, description }: Annotation): string {
  return description ? `${type}: ${description}` : type;
}

/** Tags, annotations and dimensions of the test; rows without values are left out. */
function TestMeta({ test }: { test: TestCase }) {
  const dimensions = Object.entries(test.dimensions).filter(([, values]) => values.length > 0);
  if (test.tags.length === 0 && test.annotations.length === 0 && dimensions.length === 0) return null;
  return (
    <dl class="test-meta">
      {test.tags.length > 0 && (
        <div>
          <dt>Tags</dt>
          <dd class="chips">
            {test.tags.map((tag) => (
              <span key={tag} class="tag">
                {tag}
              </span>
            ))}
          </dd>
        </div>
      )}
      {test.annotations.length > 0 && (
        <div>
          <dt>Annotations</dt>
          <dd class="chips">
            {test.annotations.map((annotation, index) => (
              <span key={index} class="tag">
                {annotationText(annotation)}
              </span>
            ))}
          </dd>
        </div>
      )}
      {dimensions.map(([name, values]) => (
        <div key={name}>
          <dt>{name}</dt>
          <dd>{values.join(', ')}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * One tab per attempt (tabs pattern: arrow keys, Home and End move between
 * them and select). The selection is in the URL (`?attempt=`).
 */
function AttemptTabs({ test, selected, select }: { test: TestCase; selected: Attempt; select: (attempt: Attempt) => void }) {
  const list = useRef<HTMLDivElement>(null);
  const focusTab = (index: number): void => {
    const attempt = test.attempts[(index + test.attempts.length) % test.attempts.length];
    if (!attempt) return;
    select(attempt);
    list.current?.querySelector<HTMLElement>(`[data-attempt="${attempt.index}"]`)?.focus();
  };
  const current = test.attempts.indexOf(selected);
  return (
    <div
      class="attempt-tabs"
      role="tablist"
      aria-label="Attempts"
      ref={list}
      onKeyDown={(event) => {
        const moves: Record<string, number> = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: test.attempts.length - 1 };
        const target = moves[event.key];
        if (target === undefined) return;
        event.preventDefault();
        focusTab(target);
      }}
    >
      {test.attempts.map((attempt) => {
        const active = attempt === selected;
        return (
          <button
            key={attempt.index}
            type="button"
            role="tab"
            id={`attempt-tab-${attempt.index}`}
            class="attempt-tab"
            data-attempt={attempt.index}
            aria-selected={active}
            aria-controls="attempt-panel"
            tabIndex={active ? 0 : -1}
            onClick={() => select(attempt)}
          >
            <OutcomeIcon outcome={ATTEMPT_STATUS_OUTCOME[attempt.status]} decorative />
            <span>{attemptLabel(attempt.index)}</span>
            <span class="visually-hidden">, {ATTEMPT_STATUS_LABELS[attempt.status]}</span>
            <span class="attempt-duration">{formatDuration(attempt.durationMs)}</span>
          </button>
        );
      })}
    </div>
  );
}

function AttemptContent({ test, attempt, params, groups, colors, playwrightVersion }: {
  test: TestCase;
  attempt: Attempt;
  playwrightVersion: string;
  params: DetailParams;
  groups: ReadonlyMap<string, ErrorGroup>;
  colors: ReadonlyMap<string, string>;
}) {
  const mode = params.allSteps ? 'all' : 'default';
  // The merge keeps the test's annotations first: what follows them is the attempt's own.
  const ownAnnotations = mergeAnnotations(test.annotations, attempt.annotations).slice(mergeAnnotations(test.annotations).length);
  return (
    <>
      {attempt.errors.length > 0 && (
        <section class="detail-section" aria-labelledby="detail-errors">
          <h2 id="detail-errors">{attempt.errors.length === 1 ? 'Error' : plural(attempt.errors.length, 'error')}</h2>
          {attempt.errors.map((error, index) => (
            <ErrorCard
              key={index}
              error={error}
              group={groups.get(error.signature)}
              color={error.category ? colors.get(error.category) : undefined}
              secondary={isSecondaryError(attempt, index)}
            />
          ))}
        </section>
      )}
      {attempt.steps.length > 0 && (
        <section class="detail-section" aria-labelledby="detail-steps">
          <div class="section-head">
            <h2 id="detail-steps">Steps</h2>
            <button
              type="button"
              class="button toggle-button"
              aria-pressed={params.allSteps}
              onClick={() => setDetailQuery(serializeDetailParams({ ...params, allSteps: !params.allSteps }))}
            >
              Show all steps
            </button>
          </div>
          <StepTree key={`${test.id}/${test.repeatEachIndex}/${attempt.index}`} steps={attempt.steps} mode={mode} />
        </section>
      )}
      {attempt.attachments.length > 0 && (
        <section class="detail-section" aria-labelledby="detail-attachments">
          <h2 id="detail-attachments">Attachments</h2>
          <Attachments key={`${test.id}/${test.repeatEachIndex}/${attempt.index}`} attachments={attempt.attachments} playwrightVersion={playwrightVersion} />
        </section>
      )}
      {ownAnnotations.length > 0 && (
        <section class="detail-section" aria-labelledby="detail-annotations">
          <h2 id="detail-annotations">Annotations of this attempt</h2>
          <ul class="chips">
            {ownAnnotations.map((annotation, index) => (
              <li key={index} class="tag">
                {annotationText(annotation)}
              </li>
            ))}
          </ul>
        </section>
      )}
      {(attempt.stdout.text !== '' || attempt.stderr.text !== '' || attempt.stdout.truncated || attempt.stderr.truncated) && (
        <section class="detail-section" aria-labelledby="detail-output">
          <h2 id="detail-output">Output</h2>
          <OutputBlock name="stdout" output={attempt.stdout} />
          <OutputBlock name="stderr" output={attempt.stderr} />
        </section>
      )}
    </>
  );
}

/**
 * Test detail (`#/test/<id>`): header, copy actions, then one attempt at a
 * time (`?attempt=<index>`, the last failing attempt by default): errors,
 * steps, attachments and output. Previous / next walk the Tests view's list.
 */
export function TestPage({
  report,
  test,
  sequence,
  groups,
  settings,
}: {
  report: LoupeReport;
  test: TestCase | undefined;
  /** The Tests view's list: filtered and sorted, without its render cap. */
  sequence: readonly TestCase[];
  groups: ReadonlyMap<string, ErrorGroup>;
  settings: RendererSettings;
}) {
  const colors = useMemo(() => categoryColorMap(report.categories), [report]);
  const params = parseDetailParams(currentLocation.value.search);
  const selection = test ? selectAttempt(test, params.attempt) : null;
  const attempt = selection?.attempt ?? null;

  // An attempt index the test does not have: back to the default attempt, URL normalized.
  useLayoutEffect(() => {
    if (selection && !selection.valid) setDetailQuery(serializeDetailParams({ ...params, attempt: null }));
  }, [selection?.valid]);

  const position = test ? neighbors(sequence, test) : null;
  const goTo = (target: TestCase | null | undefined) => (target ? () => navigate(testRoute(target)) : null);
  useShortcuts({ j: goTo(position?.next), k: goTo(position?.previous) });

  if (!test) return <NotFoundPage message="No test with this id in this report." />;

  const { primary } = shownCategories(test);
  const skip = skipReason(test);
  const inFile = fileRerun(report.tests, test);
  const select = (target: Attempt): void => setDetailQuery(serializeDetailParams({ ...params, attempt: target.index }));

  return (
    <div class="page test-page">
      <Pager
        label="Tests in the current list"
        position={position?.position ?? null}
        total={sequence.length}
        outside={`Not in the current list (${plural(sequence.length, 'test')})`}
        previous={goTo(position?.previous)}
        next={goTo(position?.next)}
        previousLabel="Previous"
        nextLabel="Next"
        keys={['k', 'j']}
      />
      <header class="test-header">
        <h1 class="test-title">
          {test.suitePath.map((part, index) => (
            <span key={index} class="title-suite">
              {part}
              <span class="title-separator"> › </span>
            </span>
          ))}
          {test.title}
          {test.repeatEachIndex > 0 && <span class="row-note"> repeat {test.repeatEachIndex}</span>}
        </h1>
        <div class="test-summary">
          <OutcomeIcon outcome={test.outcome} labelled />
          {skip && <span class="skip-reason detail-skip">{skipLabel(skip)}</span>}
          <span>{projectLabel(test.project)}</span>
          <code>
            {test.file}:{test.line}
          </code>
          <span>{formatDuration(test.durationMs)}</span>
          {primary !== null && <CategoryBadge name={primary} color={colors.get(primary)} />}
        </div>
        {skip?.kind === 'notRun' && <p class="skip-explanation">{NOT_RUN_EXPLANATION}</p>}
        <TestMeta test={test} />
        <div class="test-actions">
          <RerunButton tests={[test]}>Copy rerun command</RerunButton>
          {inFile && <RerunButton tests={inFile.tests}>Copy rerun command · {inFile.label}</RerunButton>}
          {attempt && attempt.errors.length > 0 && (
            <CopyButton
              label="AI prompt"
              help="A description of this attempt's failure, in English, to paste in the AI assistant of your choice. Nothing is sent anywhere."
              text={() => buildAiPrompt(test, attempt, { includeStack: settings.aiPrompt.includeStack })}
            >
              Copy AI prompt
            </CopyButton>
          )}
        </div>
      </header>
      {attempt && test.attempts.length > 1 && <AttemptTabs test={test} selected={attempt} select={select} />}
      {attempt && (
        <div
          class="attempt-panel"
          id="attempt-panel"
          role={test.attempts.length > 1 ? 'tabpanel' : undefined}
          aria-labelledby={test.attempts.length > 1 ? `attempt-tab-${attempt.index}` : undefined}
        >
          <AttemptContent test={test} attempt={attempt} params={params} groups={groups} colors={colors} playwrightVersion={report.run.playwrightVersion} />
        </div>
      )}
    </div>
  );
}
