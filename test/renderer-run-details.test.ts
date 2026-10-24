import { describe, expect, it } from 'vitest';
import { SCOPE_REASONS } from '../src/core/scope.js';
import { ciText, partialPillText, runDetails, scopeText, shardText } from '../src/renderer/runDetails.js';
import type { LoupeReport } from '../src/schema/v1.js';

type RunPart = Pick<LoupeReport, 'run' | 'generator'>;

function report(run: Partial<LoupeReport['run']> = {}, version = '0.1.0'): RunPart {
  return {
    generator: { name: 'playwright-loupe', version },
    run: {
      scope: 'full',
      scopeReasons: [],
      playwrightVersion: '1.64.0',
      workers: 4,
      shard: null,
      environment: { name: 'staging', ci: false, ciProvider: null, os: 'linux-x64', nodeVersion: 'v22.12.0' },
      git: { commit: null, branch: null, remote: null },
      ...run,
    } as LoupeReport['run'],
  };
}

/** Each group as [title, rows], each row as [label, value] or [label, value, full]. */
const groups = (part: RunPart) =>
  runDetails(part).map(({ title, rows }) => [title, rows.map(({ label, value, full }) => (full === undefined ? [label, value] : [label, value, full]))]);

describe('runDetails', () => {
  it('groups the fields in Run, Code and Environment, each in order, the commit short with its full hash', () => {
    const part = report({
      git: { commit: '4fe7a5e1c2d3b4a5968778695a4b3c2d1e0f9a8b', branch: 'main', remote: 'https://github.com/o/r' },
      environment: { name: 'staging', ci: true, ciProvider: 'github-actions', os: 'linux-x64', nodeVersion: 'v22.12.0' },
      shard: { current: 2, total: 4 },
    });
    expect(groups(part)).toEqual([
      ['Run', [['Scope', 'Full run'], ['CI', 'GitHub Actions'], ['Workers', '4'], ['Shard', '2 of 4']]],
      ['Code', [['Commit', '4fe7a5e', '4fe7a5e1c2d3b4a5968778695a4b3c2d1e0f9a8b'], ['Branch', 'main'], ['Repository', 'https://github.com/o/r']]],
      ['Environment', [['Playwright', '1.64.0'], ['Loupe', '0.1.0'], ['Node', 'v22.12.0'], ['OS', 'linux-x64']]],
    ]);
  });

  it('hides null and empty values, and a group left without any field', () => {
    const part = report(
      {
        playwrightVersion: '',
        git: { commit: null, branch: '  ', remote: null },
        environment: { name: null, ci: false, ciProvider: null, os: '', nodeVersion: '' },
      },
      '',
    );
    // No Code group, no Environment group: every field is empty.
    expect(groups(part)).toEqual([['Run', [['Scope', 'Full run'], ['CI', 'No'], ['Workers', '4']]]]);
    // The environment name stays in the header only.
    expect(runDetails(report()).flatMap((group) => group.rows.map((row) => row.label))).not.toContain('Environment');
  });

  it('keeps a group with a single field', () => {
    const part = report({ git: { commit: null, branch: 'main', remote: null } });
    expect(groups(part)[1]).toEqual(['Code', [['Branch', 'main']]]);
  });
});

describe('scopeText', () => {
  it('says full or partial, with the reasons of a partial run', () => {
    expect(scopeText('full', [])).toBe('Full run');
    expect(scopeText('partial', [])).toBe('Partial run');
    expect(scopeText('partial', ['grep', 'project-filter'])).toBe('Partial run: grep filter, project filter');
    expect(scopeText('partial', ['something-new'])).toBe('Partial run: something-new');
  });
});

describe('partialPillText', () => {
  it.each([
    ['env', 'Partial: LOUPE_RUN_SCOPE=partial'],
    ['file-filter', 'Partial: file filter'],
    ['grep', 'Partial: grep filter'],
    ['project-filter', 'Partial: project filter'],
    ['last-failed', 'Partial: --last-failed'],
    ['only-changed', 'Partial: --only-changed'],
    ['test-list', 'Partial: test list'],
    ['only', 'Partial: test.only'],
    ['shard', 'Partial: single shard'],
    ['list', 'Partial: --list (no test ran)'],
  ])('names the reason %s', (reason, text) => {
    expect(partialPillText([reason])).toEqual({ full: text, short: 'Partial' });
  });

  it('covers every reason the core detects', () => {
    for (const reason of SCOPE_REASONS) expect(partialPillText([reason]).full).not.toBe(`Partial: ${reason}`);
  });

  it('names the first reason and counts the others, with the labels of Run details', () => {
    expect(partialPillText(['grep', 'project-filter', 'shard']).full).toBe('Partial: grep filter +2');
    expect(scopeText('partial', ['grep', 'project-filter', 'shard'])).toContain('grep filter');
  });

  it('shows unknown reasons as is, and no reason as Partial alone', () => {
    expect(partialPillText(['something-new']).full).toBe('Partial: something-new');
    expect(partialPillText([])).toEqual({ full: 'Partial', short: 'Partial' });
  });
});

describe('ciText', () => {
  it('names the provider, or says Yes / No', () => {
    expect(ciText(true, 'gitlab')).toBe('GitLab CI');
    expect(ciText(true, 'some-ci')).toBe('some-ci');
    expect(ciText(true, null)).toBe('Yes');
    expect(ciText(false, null)).toBe('No');
  });
});

describe('shardText', () => {
  it('formats the shard, null without one', () => {
    expect(shardText({ current: 2, total: 4 })).toBe('2 of 4');
    expect(shardText(null)).toBeNull();
  });
});
