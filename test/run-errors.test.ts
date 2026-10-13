import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { TestStep } from '@playwright/test/reporter';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { failingSteps } from '../src/core/build.js';
import { esmImportLocation, isUsableLocation } from '../src/core/runErrors.js';

describe('esmImportLocation', () => {
  let dir: string;
  let spec: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'loupe-run-errors-'));
    spec = path.join(dir, 'broken.spec.ts');
    writeFileSync(
      spec,
      [
        "import { test } from '@playwright/test';",
        "  import { helper } from '../lib/missing-helper.js';",
        "import { nope } from '@scope/nope/sub';",
        "test('x', () => {});",
      ].join('\n'),
    );
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('finds the import of a missing relative module', async () => {
    const message = `Error: Cannot find module '${path.join(path.dirname(dir), 'lib', 'missing-helper.js')}' imported from ${spec}`;
    expect(await esmImportLocation(message)).toEqual({ file: spec, line: 2, column: 3 });
  });

  it('finds the import of a missing package, with a merge-reports prefix and a file URL', async () => {
    const message = `(shard-1) Error: Cannot find package '@scope/nope' imported from ${pathToFileURL(spec).href}`;
    expect(await esmImportLocation(message)).toEqual({ file: spec, line: 3, column: 1 });
  });

  it('gives up when the message is something else, the file is gone or the import is not found', async () => {
    expect(await esmImportLocation('Error: global setup boom')).toBeNull();
    expect(await esmImportLocation(`Error: Cannot find module '/x/y' imported from ${path.join(dir, 'gone.ts')}`)).toBeNull();
    expect(await esmImportLocation(`Error: Cannot find module '/x/other' imported from ${spec}`)).toBeNull();
  });
});

describe('isUsableLocation', () => {
  it('accepts absolute paths only', () => {
    expect(isUsableLocation({ file: '<anonymous>', line: 1, column: 1 })).toBe(false);
    expect(isUsableLocation(undefined)).toBe(false);
    expect(isUsableLocation({ file: path.resolve('/a/b.ts'), line: 1, column: 1 })).toBe(true);
  });
});

describe('failingSteps', () => {
  const step = (title: string, message: string | undefined, steps: TestStep[] = []): TestStep =>
    ({ title, error: message === undefined ? undefined : { message }, steps }) as unknown as TestStep;

  it('returns the chain of steps that failed with the error, outermost first', () => {
    const steps = [
      step('open the page', undefined),
      step('log in', 'Error: boom', [step('fill the form', undefined), step('Expect "toBeVisible"', 'Error: boom')]),
    ];
    expect(failingSteps(steps, { message: 'Error: boom' })).toEqual(['log in', 'Expect "toBeVisible"']);
  });

  it('finds a nested step under a parent that failed with another message', () => {
    const steps = [step('outer', 'Error: wrapped', [step('inner', 'Error: boom')])];
    expect(failingSteps(steps, { message: 'Error: boom' })).toEqual(['outer', 'inner']);
  });

  it('is empty when no step failed with the error', () => {
    expect(failingSteps([step('a', undefined)], { message: 'Error: boom' })).toEqual([]);
    expect(failingSteps([step('a', 'Error: other')], { message: 'Error: boom' })).toEqual([]);
  });
});
