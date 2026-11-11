import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LoupeConfigError, foldersOverlap, resolveConfig } from '../src/config/resolve.js';
import { validateConfig } from '../src/config/validate.js';

const BASE = path.resolve('/project');
const CWD = path.resolve('/project/sub');

function resolve(layers: { file?: unknown; inline?: Record<string, unknown>; env?: Record<string, string> } = {}) {
  const warnings: string[] = [];
  const config = resolveConfig({
    file: layers.file === undefined ? undefined : { path: path.join(BASE, 'loupe.config.ts'), config: layers.file },
    inline: layers.inline ?? {},
    env: layers.env ?? {},
    baseDir: BASE,
    cwd: CWD,
    warn: (message) => warnings.push(message),
  });
  return { history: config.history, warnings };
}

const problems = (layers: Parameters<typeof resolve>[0]): string[] => {
  try {
    resolve(layers);
  } catch (error) {
    if (error instanceof LoupeConfigError) return [...error.problems];
    throw error;
  }
  return [];
};

describe('history config: defaults', () => {
  it('is on, in loupe-history next to the Playwright config', () => {
    expect(resolve().history).toEqual({
      enabled: true,
      dir: path.join(BASE, 'loupe-history'),
      stream: { key: ['environment', 'origin'] },
      retention: { maxRuns: 200, maxAgeDays: 90 },
      include: 'full',
    });
  });

  it('resolves history.dir from the Playwright config directory', () => {
    expect(resolve({ file: { history: { dir: '../shared-history' } } }).history.dir).toBe(path.resolve(BASE, '../shared-history'));
  });

  it('resolves LOUPE_HISTORY_DIR from the working directory, like LOUPE_OUTPUT_FOLDER', () => {
    expect(resolve({ file: { history: { dir: 'ignored' } }, env: { LOUPE_HISTORY_DIR: 'h' } }).history.dir).toBe(path.join(CWD, 'h'));
  });

  it('keeps every configured option', () => {
    const history = { stream: { key: ['branch', 'environment'] }, retention: { maxRuns: 30, maxAgeDays: 7 }, include: 'all' };
    expect(resolve({ file: { history } }).history).toMatchObject({ enabled: true, ...history });
  });
});

describe('history config: true and false merge across layers', () => {
  it('history: false turns it off', () => {
    expect(resolve({ file: { history: false } }).history.enabled).toBe(false);
  });

  it('an inline object over a file false keeps it off', () => {
    const { history } = resolve({ file: { history: false }, inline: { history: { dir: 'other' } } });
    expect(history).toMatchObject({ enabled: false, dir: path.join(BASE, 'other') });
  });

  it('inline false over file options turns it off and keeps the options', () => {
    const { history } = resolve({ file: { history: { retention: { maxRuns: 5 } } }, inline: { history: false } });
    expect(history).toMatchObject({ enabled: false, retention: { maxRuns: 5, maxAgeDays: 90 } });
  });

  it('inline true over a file false turns it back on', () => {
    expect(resolve({ file: { history: false }, inline: { history: true } }).history.enabled).toBe(true);
  });

  it('a stream key replaces the lower one instead of merging item by item', () => {
    const { history } = resolve({ file: { history: { stream: { key: ['environment', 'origin', 'branch'] } } }, inline: { history: { stream: { key: ['origin'] } } } });
    expect(history.stream.key).toEqual(['origin']);
  });
});

describe('history config: LOUPE_HISTORY', () => {
  it.each([
    ['off', false],
    ['false', false],
    ['0', false],
    ['on', true],
    ['true', true],
    ['1', true],
  ])('%s sets enabled to %s and keeps the other options', (value, enabled) => {
    const { history } = resolve({ file: { history: { enabled: !enabled, dir: 'kept' } }, env: { LOUPE_HISTORY: value } });
    expect(history).toMatchObject({ enabled, dir: path.join(BASE, 'kept') });
  });

  it('on turns history: false back on', () => {
    expect(resolve({ file: { history: false }, env: { LOUPE_HISTORY: 'on' } }).history.enabled).toBe(true);
  });

  it('an empty value is ignored', () => {
    expect(resolve({ file: { history: false }, env: { LOUPE_HISTORY: ' ' } }).history.enabled).toBe(false);
  });

  it('any other value stops the run', () => {
    expect(problems({ env: { LOUPE_HISTORY: 'yes' } })).toEqual(['LOUPE_HISTORY must be one of "on", "off", "true", "false", "1", "0", got "yes"']);
  });
});

describe('history config: validation', () => {
  const validate = (history: unknown): string[] => validateConfig({ history }, 'loupe.config.ts');

  it('accepts a boolean or every option', () => {
    expect(validate(false)).toEqual([]);
    expect(validate(true)).toEqual([]);
    expect(
      validate({ enabled: true, dir: 'h', stream: { key: ['environment', 'origin', 'branch'] }, retention: { maxRuns: 1, maxAgeDays: 1 }, include: 'all' }),
    ).toEqual([]);
  });

  it('names each invalid value', () => {
    expect(validate('off')).toEqual(['loupe.config.ts: history must be a boolean or an object, got "off"']);
    expect(validate({ enabled: 'no', dir: '', include: 'some' })).toEqual([
      'loupe.config.ts: history.enabled must be a boolean, got "no"',
      'loupe.config.ts: history.dir must be a non-empty string, got ""',
      'loupe.config.ts: history.include must be one of "full", "all", got "some"',
    ]);
  });

  it('wants positive integers for retention, not a duration string', () => {
    expect(validate({ retention: { maxRuns: 0, maxAgeDays: '90d' } })).toEqual([
      'loupe.config.ts: history.retention.maxRuns must be a positive integer, got 0',
      'loupe.config.ts: history.retention.maxAgeDays must be a positive integer, got "90d"',
    ]);
    expect(validate({ retention: { maxRuns: 2.5 } })).toEqual(['loupe.config.ts: history.retention.maxRuns must be a positive integer, got 2.5']);
  });

  it('wants a non-empty stream key of known parts, each once', () => {
    expect(validate({ stream: { key: [] } })).toEqual([
      'loupe.config.ts: history.stream.key must be a non-empty array of "environment", "origin", "branch", got an array',
    ]);
    expect(validate({ stream: { key: ['origin', 'project', 'origin'] } })).toEqual([
      'loupe.config.ts: history.stream.key[1] must be one of "environment", "origin", "branch", got "project"',
      'loupe.config.ts: history.stream.key[2] repeats "origin"',
    ]);
  });

  it('rejects an unknown key in the config file with a suggestion', () => {
    expect(validate({ retension: {} })).toEqual(['loupe.config.ts: history.retension is not a known option. Did you mean "retention"?']);
  });

  it('only warns for an unknown inline key', () => {
    const { warnings } = resolve({ inline: { history: { maxRuns: 3 } } });
    expect(warnings).toEqual(['Loupe: reporter options: ignoring unknown option history.maxRuns.']);
  });
});

describe('history config: overlap with outputFolder', () => {
  it('tells overlapping folders apart from neighbours', () => {
    const p = (...parts: string[]) => path.join(BASE, ...parts);
    expect(foldersOverlap(p('a'), p('a'))).toBe(true);
    expect(foldersOverlap(p('a', 'b'), p('a'))).toBe(true);
    expect(foldersOverlap(p('a'), p('a', 'b'))).toBe(true);
    expect(foldersOverlap(p('a'), p('ab'))).toBe(false);
    expect(foldersOverlap(p('..a'), p('b'))).toBe(false);
    expect(foldersOverlap(p('a'), p('b'))).toBe(false);
  });

  it('the default folder inside the report folder: one warning, history off, no error', () => {
    const { history, warnings } = resolve({ file: { outputFolder: '.' } });
    expect(history.enabled).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^Loupe: history is off for this run: the history folder .*loupe-history and the report folder .* overlap\. Set history\.dir/);
  });

  it('the default folder holding the report folder: same', () => {
    const { history, warnings } = resolve({ file: { outputFolder: 'loupe-history/report' } });
    expect(history.enabled).toBe(false);
    expect(warnings).toHaveLength(1);
  });

  it('no warning when history is off anyway', () => {
    expect(resolve({ file: { outputFolder: '.', history: false } }).warnings).toEqual([]);
    expect(resolve({ file: { outputFolder: '.' }, env: { LOUPE_HISTORY: 'off' } }).warnings).toEqual([]);
  });

  it('an explicit history.dir overlapping it stops the run', () => {
    expect(problems({ file: { outputFolder: 'out', history: { dir: 'out/history' } } })).toEqual([
      `history.dir: the history folder ${path.join('..', 'out', 'history')} and the report folder ${path.join('..', 'out')} overlap; the history must be outside the report folder (outputFolder), which is published and replaced`,
    ]);
  });

  it('an explicit LOUPE_HISTORY_DIR overlapping it stops the run', () => {
    expect(problems({ env: { LOUPE_HISTORY_DIR: '../loupe-report' } })[0]).toMatch(/^LOUPE_HISTORY_DIR: the history folder/);
  });
});
