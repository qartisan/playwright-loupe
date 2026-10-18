import type { LoupeReport } from '../schema/v1.js';

/**
 * The Overview's Run details: run metadata from `run` and `generator`, as
 * label / value rows in three groups (Run, Code, Environment). Empty values
 * are left out, never shown as "null" or "unknown". Pure functions, no DOM:
 * unit-tested in Node.
 */

/** Reasons a run is partial (docs/schema/v1.md, "Run scope"). Unknown reasons are shown as is. */
const SCOPE_REASON_LABELS: Record<string, string> = {
  env: 'LOUPE_RUN_SCOPE=partial',
  'file-filter': 'file filter',
  grep: 'grep filter',
  'project-filter': 'project filter',
  'last-failed': '--last-failed',
  'only-changed': '--only-changed',
  'test-list': 'test list',
  only: 'test.only',
  shard: 'single shard',
  list: '--list (no test ran)',
};

export function scopeReasonLabel(reason: string): string {
  return SCOPE_REASON_LABELS[reason] ?? reason;
}

/** CI provider ids of the core (src/core/metadata.ts) and their names. Unknown ids are shown as is. */
const CI_PROVIDER_NAMES: Record<string, string> = {
  'github-actions': 'GitHub Actions',
  gitlab: 'GitLab CI',
  'azure-pipelines': 'Azure Pipelines',
  circleci: 'CircleCI',
  jenkins: 'Jenkins',
  bitbucket: 'Bitbucket Pipelines',
  buildkite: 'Buildkite',
  travis: 'Travis CI',
};

/** Length of a short commit hash, everywhere in the report. */
export const SHORT_COMMIT_LENGTH = 7;

export interface RunDetail {
  label: string;
  value: string;
  /** The full value when `value` is shortened (the commit): tooltip and copy. */
  full?: string;
}

function present(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export function scopeText(scope: LoupeReport['run']['scope'], reasons: readonly string[]): string {
  if (scope !== 'partial') return 'Full run';
  return reasons.length > 0 ? `Partial run: ${reasons.map(scopeReasonLabel).join(', ')}` : 'Partial run';
}

export function ciText(ci: boolean, provider: string | null): string {
  if (!ci) return 'No';
  const id = present(provider);
  return id === null ? 'Yes' : (CI_PROVIDER_NAMES[id] ?? id);
}

export function shardText(shard: LoupeReport['run']['shard']): string | null {
  return shard ? `${shard.current} of ${shard.total}` : null;
}

export interface RunDetailGroup {
  title: 'Run' | 'Code' | 'Environment';
  rows: RunDetail[];
}

/** The rows in three groups, each in the brief's field order; a group without any row is left out. */
export function runDetails(report: Pick<LoupeReport, 'run' | 'generator'>): RunDetailGroup[] {
  const { run, generator } = report;
  const commit = present(run.git.commit);
  const groups: Array<{ title: RunDetailGroup['title']; rows: Array<RunDetail | null> }> = [
    {
      title: 'Run',
      rows: [
        { label: 'Scope', value: scopeText(run.scope, run.scopeReasons) },
        { label: 'CI', value: ciText(run.environment.ci, run.environment.ciProvider) },
        Number.isFinite(run.workers) ? { label: 'Workers', value: String(run.workers) } : null,
        text('Shard', shardText(run.shard)),
      ],
    },
    {
      title: 'Code',
      rows: [
        commit === null ? null : { label: 'Commit', value: commit.slice(0, SHORT_COMMIT_LENGTH), full: commit },
        text('Branch', run.git.branch),
        text('Repository', run.git.remote),
      ],
    },
    {
      title: 'Environment',
      rows: [text('Playwright', run.playwrightVersion), text('Loupe', generator.version), text('Node', run.environment.nodeVersion), text('OS', run.environment.os)],
    },
  ];
  return groups
    .map(({ title, rows }) => ({ title, rows: rows.filter((row): row is RunDetail => row !== null) }))
    .filter((group) => group.rows.length > 0);
}

function text(label: string, value: string | null | undefined): RunDetail | null {
  const shown = present(value);
  return shown === null ? null : { label, value: shown };
}
