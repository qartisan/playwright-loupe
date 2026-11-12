import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CANARY, HOMES, SECRETS } from '../fixtures/leak/homes.js';
import { homePaths } from '../scripts/home-paths.mjs';
import type { LoupeReport, Step, TestCase } from '../src/schema/v1.js';
import { REDACTED } from '../src/shared/redaction.js';
import { MIN_PLAYWRIGHT_TRACE_VIEWER, isBelow } from '../src/core/support.js';
import { GENERIC_HOMES, createPathRewriter } from '../src/core/paths.js';
import { assertBuilt, playwright, readReport } from './helpers/fixtures.js';

/**
 * Home directories in every place a report can hold one, written by a real run of
 * fixtures/leak.config.ts: `report.json` and `index.html` hold neither the real
 * home nor the canary user name. Not the real user name: a short or common one
 * (`runner`) would be found anywhere.
 */
describe('the leak canary', () => {
  let workDir: string;
  let outputFolder: string;
  let status: number | null;
  let output: string;
  let report: LoupeReport;
  let homeTests: TestCase[];

  beforeAll(() => {
    assertBuilt();
    workDir = mkdtempSync(path.join(tmpdir(), 'loupe-leak-'));
    outputFolder = path.join(workDir, 'report');
    ({ status, output } = playwright(['test', '--config', 'fixtures/leak.config.ts', '--output', path.join(workDir, 'results')], { LOUPE_FIXTURE_OUTPUT: outputFolder }));
    report = readReport(outputFolder, `Exit code ${status}.\n${output}`);
    homeTests = report.tests.filter((test) => test.file === 'leak.spec.ts');
  }, 120_000);

  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  const files = (): string[] => ['report.json', 'index.html'].map((file) => readFileSync(path.join(outputFolder, file), 'utf8'));

  it('fails every test, on purpose', () => {
    expect(status, output).toBe(1);
    expect(homeTests).toHaveLength(HOMES.length);
    expect(homeTests.every((test) => test.outcome === 'failed')).toBe(true);
  });

  it('really writes a home in every place, masked', () => {
    const masked = expect.stringContaining('~');
    expect(report.projects[0]?.name).toEqual(masked);
    for (const test of homeTests) {
      const attempt = test.attempts[0];
      const step = attempt?.steps.find((candidate: Step) => candidate.title.startsWith('step '));
      const [soft, thrown] = attempt?.errors ?? [];
      expect(test.project).toEqual(masked);
      expect(test.title).toEqual(masked);
      expect(test.suitePath[0]).toEqual(masked);
      expect(test.tags[0]).toEqual(masked);
      expect(test.annotations.map((annotation) => annotation.description)).toEqual([masked, masked]);
      expect(step?.title).toEqual(masked);
      expect(soft?.message).toEqual(masked);
      expect(thrown?.message).toEqual(masked);
      expect(thrown?.stack).toEqual(masked);
      expect(attempt?.stdout.text).toEqual(masked);
      expect(attempt?.stderr.text).toEqual(masked);
      expect(attempt?.attachments.map((attachment) => attachment.name)).toEqual(expect.arrayContaining([masked]));
    }
  });

  it('holds no secret: in a tag, a dimension value, or the name of a dimension', () => {
    for (const text of files()) {
      for (const secret of Object.values(SECRETS)) expect(text).not.toContain(secret);
      expect(text).not.toContain('c0lon');
    }
    const test = report.tests.find((candidate) => candidate.file === 'secrets.spec.ts');
    // Two secrets become one name, with their values merged; one holding the `:` gives no name of its own.
    expect(test?.dimensions).toEqual({ [REDACTED]: ['x', 'y', 'z'], kept: [REDACTED] });
    expect(test?.tags).toEqual([`@${REDACTED}:x`, `@${REDACTED}:y`, `@${REDACTED}`, `@${REDACTED}:z`, `@kept:${REDACTED}`]);
    expect(report.dimensions.map((dimension) => dimension.name)).toEqual(expect.arrayContaining([REDACTED, 'kept']));
  });

  it('holds no secret in the names of the files it wrote, each attachment keeping its own file', () => {
    const names = readdirSync(path.join(outputFolder, 'data'), { recursive: true, encoding: 'utf8' }).join('\n');
    expect(names).toContain('attachment.txt');
    for (const secret of Object.values(SECRETS)) {
      for (const part of secret.split(':')) expect(names).not.toContain(part);
    }
    const test = report.tests.find((candidate) => candidate.title === 'holds secrets in its attachments');
    const attachments = test?.attempts[0]?.attachments ?? [];
    expect(attachments.map((attachment) => attachment.name)).toEqual([`log ${REDACTED}`, `log ${REDACTED}`, 'clean name', 'clean name']);
    expect(attachments.map((attachment) => path.basename(attachment.path ?? ''))).toEqual(['attachment.txt', 'attachment-1.txt', 'attachment-2.txt', 'attachment-3.txt']);
    expect(attachments.map((attachment) => readFileSync(path.join(outputFolder, attachment.path ?? ''), 'utf8').charAt(0))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('holds no canary name', () => {
    for (const text of files()) expect(text.toLowerCase()).not.toContain(CANARY);
  });

  it('holds no real home', () => {
    const home = homedir();
    // A single segment (`/root`) can be anything in a path: it keeps its boundaries, and is no name to find.
    if (home.split(/[\\/]/).filter(Boolean).length < 2) return;
    for (const text of files()) {
      expect(text).not.toContain(home);
      expect(text).not.toContain(JSON.stringify(home).slice(1, -1));
    }
  });

  it('holds no canary name in the names of the files it wrote', () => {
    const names = readdirSync(path.join(outputFolder, 'data'), { recursive: true, encoding: 'utf8' });
    expect(names.length).toBeGreaterThan(0);
    expect(names.join('\n').toLowerCase()).not.toContain(CANARY);
  });

  it('holds no home, canary name or secret with the bundled trace viewer on', () => {
    const folder = path.join(workDir, 'report-viewer');
    const result = playwright(['test', '--config', 'fixtures/leak.config.ts', '--output', path.join(workDir, 'results-viewer')], {
      LOUPE_FIXTURE_OUTPUT: folder,
      LOUPE_TRACE_VIEWER: 'bundled',
    });
    readReport(folder, `Exit code ${result.status}.\n${result.output}`);
    // Below its minimum Playwright, the option is on and nothing is copied: the canary holds either way.
    const copied = !isBelow(createRequire(import.meta.url)('@playwright/test/package.json').version, MIN_PLAYWRIGHT_TRACE_VIEWER);
    expect(existsSync(path.join(folder, 'trace-viewer', 'index.html'))).toBe(copied);
    for (const file of ['report.json', 'index.html']) {
      const text = readFileSync(path.join(folder, file), 'utf8');
      expect(text.toLowerCase()).not.toContain(CANARY);
      for (const secret of Object.values(SECRETS)) expect(text).not.toContain(secret);
      const home = homedir();
      if (home.split(/[\\/]/).filter(Boolean).length >= 2) expect(text).not.toContain(home);
    }
  }, 120_000);

  it('masks a home before a tag is split into a dimension, whose names match the definitions', () => {
    const names = report.dimensions.map((dimension) => dimension.name);
    for (const test of report.tests) {
      expect(names).toEqual(expect.arrayContaining(Object.keys(test.dimensions)));
    }
    expect(names).toContain('reads');
    // POSIX: the home before the first `:` is a masked name. Windows: the drive is not taken for a prefix.
    expect(names).toContain('~/a.json');
    expect(names).not.toContain('C');
    const inPosix = homeTests.find((test) => test.title === 'reads ~/a.json');
    expect(inPosix?.dimensions['~/a.json']).toEqual(['value']);
    expect(inPosix?.dimensions['reads']).toContain('~/a.json');
  });

  it('keeps two attachments of an attempt apart when their names hold a home', () => {
    for (const test of homeTests) {
      const stored = test.attempts[0]?.attachments.filter((attachment) => /^(?:file|other) /.test(attachment.name)) ?? [];
      expect(stored.map((attachment) => path.basename(attachment.path ?? ''))).toEqual(['attachment.txt', 'attachment-1.txt']);
      const bodies = stored.map((attachment) => readFileSync(path.join(outputFolder, attachment.path ?? ''), 'utf8'));
      expect(bodies).toEqual(['x'.repeat(5000), 'y'.repeat(5000)]);
    }
  });

  it('passes the check of the scripts that publish a report', () => {
    for (const text of files()) expect(homePaths(text)).toEqual([]);
  });
});

describe('homePaths, the check of the scripts that publish a report', () => {
  /** One home of each generic form of the reporter, at least. */
  const FORMS = [
    '/home/bob/x',
    '/Users/bob/x',
    '/var/home/bob/x',
    '/root/x',
    '/mnt/c/Users/bob/x',
    '/mnt/D/users/bob/x',
    '/cygdrive/c/Users/bob/x',
    '/c/Users/bob/x',
    'C:\\Users\\bob\\x',
    'C:/Users/bob/x',
    '\\\\wsl$\\Ubuntu\\home\\bob\\x',
    '\\\\wsl.localhost\\Ubuntu\\home\\bob\\x',
    // Converted by Playwright on Windows (src/core/paths.ts).
    '\\home\\bob\\x',
    '\\Users\\bob\\x',
    '\\users\\John bob\\x',
    '\\var\\home\\bob\\x',
    '\\root\\x',
    '\\mnt\\c\\Users\\bob\\x',
    '\\cygdrive\\c\\Users\\bob\\x',
    '\\c\\Users\\bob\\x',
    'wsl$\\Ubuntu\\home\\bob\\x',
    'wsl.localhost\\Ubuntu\\home\\bob\\x',
  ];

  it('has a sample of every generic home of the reporter', () => {
    for (const entry of GENERIC_HOMES) {
      const form = new RegExp(`^(?:${entry.source})`);
      expect(FORMS.some((sample) => form.test(sample)), `no sample for ${entry.source}`).toBe(true);
    }
  });

  it('finds every generic form, raw and JSON-escaped', () => {
    for (const form of FORMS) {
      expect(homePaths(form, '/nowhere'), form).not.toEqual([]);
      expect(homePaths(JSON.stringify(form), '/nowhere'), form).not.toEqual([]);
    }
  });

  it('finds nothing in what the reporter makes of every generic form', () => {
    const paths = createPathRewriter({ roots: ['/opt/app'], home: null });
    for (const form of FORMS) {
      for (const text of [form, JSON.stringify(form)]) expect(homePaths(paths.text(text), '/nowhere'), text).toEqual([]);
    }
  });

  it('leaves a URL path, a masked path and another mount alone', () => {
    for (const text of ['http://host/home/bob/x', '~/x', '/mnt/data/x', 'GET /a/users/42', '/opt/x', 'src\\home\\bob\\x', '~\\x', '\\mnt\\data\\x', 'mywsl$\\Ubuntu\\home\\bob\\x']) {
      expect(homePaths(text, '/nowhere'), text).toEqual([]);
    }
  });
});
