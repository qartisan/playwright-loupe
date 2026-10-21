import { describe, expect, it } from 'vitest';
import { NOT_RUN_EXPLANATION, skipDescription, skipLabel, skipReason } from '../src/renderer/skip.js';
import type { Annotation, Attempt, AttemptStatus, TestCase } from '../src/schema/v1.js';

/**
 * skipReason on the cases of the brief 10s inventory (Playwright 1.52 and
 * 1.64 record the same annotations): every skip API leaves a `skip` or
 * `fixme` annotation on the test and on its attempt; a test Playwright did
 * not run has none.
 */

function attempt(status: AttemptStatus, annotations: Annotation[] = []): Attempt {
  return {
    index: 0,
    status,
    startedAt: '2026-10-21T00:00:00.000Z',
    durationMs: 0,
    workerIndex: 0,
    errors: [],
    steps: [],
    attachments: [],
    annotations,
    stdout: { text: '', truncated: false },
    stderr: { text: '', truncated: false },
  };
}

type SkipFields = Pick<TestCase, 'outcome' | 'annotations' | 'attempts'>;

/** A test skipped through a skip API: the annotations on the test and on its one attempt, as Playwright records them. */
function skipped(annotations: Annotation[]): SkipFields {
  return { outcome: 'skipped', annotations, attempts: [attempt('skipped', annotations)] };
}

const skip = (description: string | null = null): Annotation => ({ type: 'skip', description });
const fixme = (description: string | null = null): Annotation => ({ type: 'fixme', description });

describe('skipReason', () => {
  it.each([
    ['test.skip(title, body), test.skip(), describe.skip', skipped([skip()]), { kind: 'skip', text: null }],
    ['test.fixme(title, body), describe.fixme', skipped([fixme()]), { kind: 'fixme', text: null }],
    ['test.skip(condition, reason), in a test, a describe or a hook', skipped([skip('Runs on chromium-a only')]), { kind: 'skip', text: 'Runs on chromium-a only' }],
    ['test.fixme(condition, reason)', skipped([fixme('Export button not implemented yet')]), { kind: 'fixme', text: 'Export button not implemented yet' }],
    ['a reason with spaces around it', skipped([skip('  feature flag off \n')]), { kind: 'skip', text: 'feature flag off' }],
    ['a blank reason', skipped([skip('   ')]), { kind: 'skip', text: null }],
  ] as const)('%s', (_, test, expected) => {
    expect(skipReason(test)).toEqual(expected);
  });

  it('reads the last attempt first, then the test', () => {
    const attemptOnly: SkipFields = { outcome: 'skipped', annotations: [], attempts: [attempt('skipped', [skip('from the attempt')])] };
    expect(skipReason(attemptOnly)).toEqual({ kind: 'skip', text: 'from the attempt' });
    const testOnly: SkipFields = { outcome: 'skipped', annotations: [fixme('from the test')], attempts: [attempt('skipped')] };
    expect(skipReason(testOnly)).toEqual({ kind: 'fixme', text: 'from the test' });
    const both: SkipFields = { outcome: 'skipped', annotations: [skip('test')], attempts: [attempt('failed'), attempt('skipped', [fixme('last attempt')])] };
    expect(skipReason(both)).toEqual({ kind: 'fixme', text: 'last attempt' });
  });

  it('keeps the first skip annotation with a description, else the first one', () => {
    // test.fixme('title') inside a describe skipped with a reason: Playwright records both.
    expect(skipReason(skipped([skip('Not supported on Chromium'), fixme()]))).toEqual({ kind: 'skip', text: 'Not supported on Chromium' });
    expect(skipReason(skipped([fixme(), skip('described')]))).toEqual({ kind: 'skip', text: 'described' });
    expect(skipReason(skipped([fixme(), skip()]))).toEqual({ kind: 'fixme', text: null });
  });

  it('ignores other annotation types', () => {
    const annotations = [{ type: 'serial', description: null }, { type: 'issue', description: 'https://example.invalid/1' }, skip('flag off')];
    expect(skipReason(skipped(annotations))).toEqual({ kind: 'skip', text: 'flag off' });
  });

  it('says "not run" for a skipped test without any skip annotation', () => {
    // A dependency project or an earlier test of a serial group failed, --max-failures, an interrupted run.
    expect(skipReason({ outcome: 'skipped', annotations: [], attempts: [] })).toEqual({ kind: 'notRun', text: null });
    expect(skipReason({ outcome: 'skipped', annotations: [{ type: 'serial', description: null }], attempts: [attempt('skipped'), attempt('skipped')] })).toEqual({ kind: 'notRun', text: null });
  });

  it('is null for a test that was not skipped, skip annotation or not', () => {
    expect(skipReason({ outcome: 'passed', annotations: [], attempts: [attempt('passed')] })).toBeNull();
    // Failed, then skipped on the retry: flaky, left as it is.
    expect(skipReason({ outcome: 'flaky', annotations: [skip('on retry')], attempts: [attempt('failed'), attempt('skipped', [skip('on retry')])] })).toBeNull();
    expect(skipReason({ outcome: 'failed', annotations: [{ type: 'fail', description: 'expected to fail' }], attempts: [attempt('passed')] })).toBeNull();
  });
});

describe('skipLabel and skipDescription', () => {
  it('words each kind, with and without a reason', () => {
    expect(skipLabel({ kind: 'skip', text: 'flag off' })).toBe('Skipped: flag off');
    expect(skipLabel({ kind: 'fixme', text: 'not ready' })).toBe('Fixme: not ready');
    expect(skipLabel({ kind: 'skip', text: null })).toBe('Skipped (no reason given)');
    expect(skipLabel({ kind: 'fixme', text: null })).toBe('Fixme (no reason given)');
    expect(skipLabel({ kind: 'notRun', text: null })).toBe('Not run');
  });

  it('explains "Not run" in the full text, without asserting a cause', () => {
    expect(skipDescription({ kind: 'skip', text: 'flag off' })).toBe('Skipped: flag off');
    expect(skipDescription({ kind: 'notRun', text: null })).toBe(`Not run. ${NOT_RUN_EXPLANATION}`);
    expect(NOT_RUN_EXPLANATION).toMatch(/^Playwright skipped this test without a skip annotation, usually because /);
  });
});
