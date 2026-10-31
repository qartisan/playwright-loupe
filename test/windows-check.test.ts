import { existsSync, globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './helpers/fixtures.js';

/** The Windows job only runs for its paths, so a renamed file would silently stop triggering it. */
describe('windows-check workflow', () => {
  const workflow = readFileSync(path.join(ROOT, '.github/workflows/windows-check.yml'), 'utf8');
  const paths = [...workflow.matchAll(/^ {6}- ([^\s#]+)$/gm)].map((match) => match[1] ?? '');

  it('triggers on paths that exist', () => {
    expect(paths).toContain('src/renderer/detail/rerun.ts');
    expect(paths).toContain('fixtures/windows-check/**');
    // What produces the file, title, project and tags of a test: a change there can break Windows only.
    for (const file of ['src/core/identity.ts', 'src/core/build.ts', 'src/core/paths.ts']) expect(paths).toContain(file);
    for (const pattern of paths) expect(globSync(pattern, { cwd: ROOT }).length, pattern).toBeGreaterThan(0);
  });

  it('is triggered by the same paths on push and pull request, and weekly', () => {
    const listOf = (event: string): string => workflow.match(new RegExp(`^ {2}${event}:\\n {4}paths:\\n((?: {6}- .*\\n)+)`, 'm'))?.[1] ?? '';
    expect(listOf('push')).not.toBe('');
    expect(listOf('pull_request')).toBe(listOf('push'));
    expect(workflow).toMatch(/^ {2}schedule:$/m);
  });

  it('fails when a shell is missing instead of skipping it', () => {
    expect(workflow).toContain('node check.mjs --require-all-shells');
    expect(workflow).toContain('runs-on: windows-latest');
  });

  it('runs a file the workflow names', () => {
    for (const file of ['check-checkout.mjs', 'build.mjs', 'check.mjs', 'setup.mjs']) expect(existsSync(path.join(ROOT, 'fixtures/windows-check', file)), file).toBe(true);
  });
});
