import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PALETTE } from '../src/core/categories.js';
import type { Attachment, LoupeReport } from '../src/schema/v1.js';
import { FIXTURE_CONFIG, assertBuilt, findTest, playwright, readReport, userSteps } from './helpers/fixtures.js';
import { schemaErrors } from './helpers/schema.js';

const PROJECTS = ['chromium-a', 'chromium-b'];

/**
 * Attachments Playwright adds by itself (video, trace, error context) vary in
 * name and presence across versions (`error-context` in 1.64, `_error-context-0`
 * in 1.52); other tests check that they are copied.
 */
function isStableAttachment(attachment: Attachment): boolean {
  return attachment.kind !== 'video' && attachment.kind !== 'trace' && !attachment.name.includes('error-context');
}

/**
 * Keeps what must not change between runs, machines and supported Playwright
 * versions: identity, outcomes, categories, user steps and attachment layout.
 * Messages, signatures of Playwright errors, timings and environment are left out.
 */
function normalize(report: LoupeReport): unknown {
  return {
    schemaVersion: report.schemaVersion,
    run: {
      status: report.run.status,
      scope: report.run.scope,
      scopeReasons: report.run.scopeReasons,
      shard: report.run.shard,
      excluded: report.run.excluded,
      notes: report.run.notes,
      stats: report.run.stats,
      environment: report.run.environment.name,
      errors: report.run.errors,
    },
    projects: report.projects,
    categories: report.categories,
    dimensions: report.dimensions,
    tests: report.tests.map((test) => ({
      id: test.id,
      repeatEachIndex: test.repeatEachIndex,
      project: test.project,
      location: `${test.file}:${test.line}:${test.column}`,
      suitePath: test.suitePath,
      title: test.title,
      tags: test.tags,
      annotations: test.annotations,
      outcome: test.outcome,
      expectedStatus: test.expectedStatus,
      dimensions: test.dimensions,
      category: test.category,
      attempts: test.attempts.map((attempt) => ({
        index: attempt.index,
        status: attempt.status,
        errors: attempt.errors.length > 0,
        steps: userSteps(attempt.steps),
        attachments: attempt.attachments.filter(isStableAttachment).map((attachment) => ({
          name: attachment.name,
          kind: attachment.kind,
          comparison: attachment.comparison,
          stored: attachment.path ? 'file' : attachment.body !== null ? `inline: ${attachment.body}` : 'missing',
        })),
        stdout: attempt.stdout,
        stderr: attempt.stderr,
      })),
    })),
  };
}

describe('fixture suite with the built reporter', () => {
  let workDir: string;
  let outputFolder: string;
  let exitCode: number | null;
  let report: LoupeReport;
  let html: string;

  beforeAll(() => {
    assertBuilt();
    workDir = mkdtempSync(path.join(tmpdir(), 'loupe-fixtures-'));
    outputFolder = path.join(workDir, 'report');

    const result = playwright(['test', '--config', FIXTURE_CONFIG, '--output', path.join(workDir, 'test-results')], {
      LOUPE_FIXTURE_OUTPUT: outputFolder,
    });
    exitCode = result.status;
    report = readReport(outputFolder, `Exit code ${exitCode}.\n${result.output}`);
    html = readFileSync(path.join(outputFolder, 'index.html'), 'utf8');
  }, 240_000);

  afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it('exits with code 1 because of the intentional failures', () => {
    expect(exitCode).toBe(1);
  });

  it('produces a schema v1 report that validates against the JSON Schema', () => {
    expect(report.schemaVersion).toBe(1);
    expect(schemaErrors(report)).toEqual([]);
  });

  it('describes a full, failed run', () => {
    expect(report.run.status).toBe('failed');
    expect(report.run.scope).toBe('full');
    expect(report.run.scopeReasons).toEqual([]);
    expect(report.run.shard).toBeNull();
    expect(report.run.stats.total).toBe(report.tests.length);
    expect(report.projects.map((project) => project.name)).toEqual(PROJECTS);
  });

  it('reports every outcome', () => {
    expect(new Set(report.tests.map((test) => test.outcome))).toEqual(new Set(['passed', 'failed', 'flaky', 'skipped']));
  });

  it('gives each test a unique id, different per project', () => {
    expect(new Set(report.tests.map((test) => test.id)).size).toBe(report.tests.length);
    const [a, b] = PROJECTS.map((project) => findTest(report, project, 'shows the heading').id);
    expect(a).not.toBe(b);
  });

  it('uses POSIX paths relative to the root dir', () => {
    expect(new Set(report.tests.map((test) => test.file))).toEqual(
      new Set(['basics.spec.ts', 'failures.spec.ts', 'outcomes.spec.ts', 'structure.spec.ts']),
    );
    const failing = findTest(report, 'chromium-a', 'fails on a wrong heading (intentional)');
    expect(failing.attempts[0]?.errors[0]?.location?.file).toBe('basics.spec.ts');
  });

  it('rebuilds nested describe blocks and steps', () => {
    const test = findTest(report, 'chromium-a', 'runs nested steps');
    expect(test.suitePath).toEqual(['structure', 'nested level', 'deepest level']);
    expect(userSteps(test.attempts[0]?.steps ?? [])).toEqual([{ 'open the page': ['check the button'] }]);
    expect(test.tags).toEqual(['@area:checkout', '@layer:ui', '@smoke']);
    expect(test.dimensions).toEqual({ Layer: ['ui'], area: ['checkout'] });
  });

  it('applies fixtures/loupe.config.ts', () => {
    expect(report.run.environment.name).toBe('fixtures');
    expect(report.run.errors).toEqual([]);
  });

  it('builds configured dimensions from tags and annotations, keeping the other automatic ones', () => {
    expect(report.dimensions).toEqual([
      // `values` deliberately misses "ui", used by the suite.
      { name: 'Layer', source: 'tag', key: 'layer', values: ['api', 'e2e'] },
      { name: 'Bug', source: 'annotation', key: 'bug', values: null },
      { name: 'area', source: 'tag', key: 'area', values: null },
    ]);
    for (const project of PROJECTS) {
      const test = findTest(report, project, 'fails on a wrong heading (intentional)');
      expect(test.dimensions).toEqual({ Layer: ['ui'], Bug: ['BUG-1'] });
    }
    expect(report.tests.some((test) => 'layer' in test.dimensions)).toBe(false);
    expect(report.tests.filter((test) => test.dimensions['Bug'])).toHaveLength(PROJECTS.length);
  });

  it('gives the same signature to the same error with different UUID, URL and duration', () => {
    const tests = PROJECTS.flatMap((project) => [
      findTest(report, project, 'syncs the first order (intentional)'),
      findTest(report, project, 'syncs the second order (intentional)'),
    ]);
    const messages = tests.flatMap((test) => test.attempts.map((attempt) => attempt.errors[0]?.message));
    expect(new Set(messages).size).toBe(messages.length);
    expect(new Set(tests.map((test) => test.errorSignature)).size).toBe(1);
    expect(tests[0]?.errorSignature).toMatch(/^[0-9a-f]{12}$/);
    expect(tests.map((test) => test.category)).toEqual(Array(4).fill('Uncategorized'));
  });

  it('lets the custom category rule win over the built-in rules', () => {
    for (const project of PROJECTS) {
      const test = findTest(report, project, 'differs from the screenshot baseline (intentional)');
      // Without the rule, the screenshot failure is an "Assertion".
      expect(test.category).toBe('Visual regression');
      expect(test.attempts.flatMap((attempt) => attempt.errors.map((error) => error.category))).toContain('Visual regression');
    }
    expect(report.categories[0]).toEqual({ name: 'Visual regression', color: PALETTE[0], builtIn: false });
  });

  it('puts one failure in each built-in category', () => {
    const category = (title: string): string | null => findTest(report, 'chromium-a', title).category;
    expect(category('times out (intentional)')).toBe('Timeout');
    expect(category('does not find a locator (intentional)')).toBe('Locator not found');
    expect(category('hits a network error (intentional)')).toBe('Network');
    expect(category('fails on a wrong heading (intentional)')).toBe('Assertion');
    expect(report.categories.map((definition) => definition.name)).toEqual([
      'Visual regression',
      'Locator not found',
      'Network',
      'Assertion',
      'Timeout',
      'Uncategorized',
    ]);
  });

  it('exposes the screenshot comparison triplet, with files in the report folder', () => {
    const test = findTest(report, 'chromium-a', 'differs from the screenshot baseline (intentional)');
    for (const attempt of test.attempts) {
      const images = attempt.attachments.filter((attachment) => attachment.comparison);
      expect(images.map((image) => image.comparison)).toEqual([
        { group: 'square.png', role: 'expected' },
        { group: 'square.png', role: 'actual' },
        { group: 'square.png', role: 'diff' },
      ]);
      for (const image of images) {
        expect(image.path).toMatch(new RegExp(`^data/${test.id}/${attempt.index}/`));
        expect(existsSync(path.join(outputFolder, image.path ?? ''))).toBe(true);
      }
    }
  });

  it('keeps both attempts of flaky tests, each with its own errors and attachments', () => {
    for (const project of PROJECTS) {
      const test = findTest(report, project, 'is flaky: fails on the first attempt, passes on retry (intentional)');
      expect(test.outcome).toBe('flaky');
      expect(test.attempts.map((attempt) => attempt.status)).toEqual(['failed', 'passed']);
      const [first, second] = test.attempts;
      expect(first?.errors).toHaveLength(1);
      expect(second?.errors).toEqual([]);
      expect(first?.attachments.find((attachment) => attachment.name === 'attempt')?.body).toBe('attempt 0');
      expect(second?.attachments.find((attachment) => attachment.name === 'attempt')?.body).toBe('attempt 1');
      expect(first?.attachments.some((attachment) => attachment.kind === 'trace')).toBe(true);
      expect(test.category).toBe('Assertion');
      expect(test.errorSignature).toBe(first?.errors[0]?.signature);
    }
  });

  it('copies every file attachment into the report folder', () => {
    const paths = report.tests.flatMap((test) =>
      test.attempts.flatMap((attempt) => attempt.attachments.flatMap((attachment) => attachment.path ?? [])),
    );
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.filter((file) => !existsSync(path.join(outputFolder, file)))).toEqual([]);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('captures stdout and stderr per attempt', () => {
    const attempt = findTest(report, 'chromium-a', 'writes to stdout and stderr').attempts[0];
    expect(attempt?.stdout).toEqual({ text: 'Hello from the fixture suite\n', truncated: false });
    expect(attempt?.stderr).toEqual({ text: 'A warning from the fixture suite\n', truncated: false });
  });

  it('embeds the same data and the renderer settings in index.html', () => {
    const embedded = (id: string): unknown => {
      const open = `<script id="${id}" type="application/json">`;
      const start = html.indexOf(open) + open.length;
      return JSON.parse(html.slice(start, html.indexOf('</script>', start)));
    };
    expect(embedded('loupe-data')).toEqual(report);
    // The inline title wins over the one in loupe.config.ts; theme and view come from the file.
    expect(embedded('loupe-settings')).toEqual({
      title: 'Loupe fixture suite',
      theme: 'dark',
      screenshots: { defaultView: 'slider' },
    });
  });

  it('matches the normalized snapshot', () => {
    expect(normalize(report)).toMatchSnapshot();
  });
});
