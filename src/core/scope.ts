import type { RunScope } from '../schema/v1.js';

/**
 * Best-effort detection of partial runs. What a reporter can see (checked
 * against Playwright 1.52–1.64):
 *
 * - CLI `--grep`, file filters, `--last-failed`, `--only-changed` and
 *   `--test-list` never reach the resolved config: the only trace is the
 *   command line (`config.argv` from 1.61, `process.argv` before).
 * - `--project` is visible as `config.filteredProjects` from 1.64; earlier, the
 *   command line plus the projects present in the suite are used.
 * - A `grep` / `grepInvert` in the config file is visible in the config.
 * - `test.only` is only visible through Playwright's internal `_only` flag.
 *
 * Limits are documented in docs/schema/v1.md ("Run scope").
 */

/** Reasons, in the order they are reported. */
export const SCOPE_REASONS = [
  'env',
  'file-filter',
  'grep',
  'project-filter',
  'last-failed',
  'only-changed',
  'test-list',
  'only',
  'shard',
  'list',
] as const;
export type ScopeReason = (typeof SCOPE_REASONS)[number];

/** `playwright test` options that take a value (the next token, or `--opt=value`). */
const VALUE_OPTIONS = new Set([
  '-c', '--config',
  '-g', '--grep',
  '--grep-invert',
  '--project',
  '-j', '--workers',
  '--reporter',
  '--retries',
  '--timeout',
  '--global-timeout',
  '--max-failures',
  '--output',
  '--repeat-each',
  '--shard',
  '--trace',
  '--tsconfig',
  '--update-source-method',
  '--browser',
  '--test-list',
  '--test-list-invert',
  '--ui-host',
  '--ui-port',
]);

/** Options with an optional value: like commander, they take the next token unless it starts with '-'. */
const OPTIONAL_VALUE_OPTIONS = new Set(['--only-changed', '-u', '--update-snapshots']);

export interface TestCommand {
  /** Positional arguments: file / line filters. */
  filters: string[];
  /** Option names used (long form when given that way), e.g. '--grep', '-g'. */
  options: Set<string>;
}

/** Parses `playwright test` arguments from a full argv; null when the command is not `test`. */
export function parseTestCommand(argv: readonly string[]): TestCommand | null {
  const args = argv.slice(2);
  if (args[0] !== 'test') return null;
  const command: TestCommand = { filters: [], options: new Set() };
  for (let i = 1; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (arg === '--') {
      command.filters.push(...args.slice(i + 1));
      break;
    }
    if (!arg.startsWith('-') || arg === '-') {
      command.filters.push(arg);
      continue;
    }
    const equals = arg.indexOf('=');
    const name = arg.startsWith('--') && equals !== -1 ? arg.slice(0, equals) : arg;
    // Short options with an attached value, e.g. `-gsmoke`.
    const short = !arg.startsWith('--') && arg.length > 2 && VALUE_OPTIONS.has(arg.slice(0, 2)) ? arg.slice(0, 2) : null;
    if (short) {
      command.options.add(short);
      continue;
    }
    command.options.add(name);
    if (name !== arg) continue;
    if (VALUE_OPTIONS.has(name)) i++;
    else if (OPTIONAL_VALUE_OPTIONS.has(name) && args[i + 1] !== undefined && !args[i + 1]?.startsWith('-')) i++;
  }
  return command;
}

export interface ProjectRef {
  name: string;
  dependencies: readonly string[];
  teardown?: string | undefined;
}

export interface ScopeInput {
  argv: readonly string[];
  /** `grep` / `grepInvert` set in the config file (not their defaults). */
  configGrep: boolean;
  shard: boolean;
  /** All projects of the config. */
  projects: readonly ProjectRef[];
  /** `config.filteredProjects` names when Playwright exposes them (1.64+); empty under merge-reports. */
  filteredProjects: readonly string[] | undefined;
  /** Names of the projects that have a suite in this run. */
  runProjects: readonly string[];
  /** A `test.only` / `describe.only` is in effect. */
  only: boolean;
}

/** Projects that run when `selected` are requested: their dependencies and teardowns included. */
function withDependencies(selected: readonly string[], projects: readonly ProjectRef[]): Set<string> {
  const byName = new Map(projects.map((project) => [project.name, project]));
  const result = new Set<string>();
  const pending = [...selected];
  while (pending.length > 0) {
    const name = pending.pop() as string;
    if (result.has(name)) continue;
    result.add(name);
    const project = byName.get(name);
    if (!project) continue;
    pending.push(...project.dependencies);
    if (project.teardown) pending.push(project.teardown);
  }
  return result;
}

function hasProjectFilter(input: ScopeInput, command: TestCommand | null): boolean {
  const all = input.projects.map((project) => project.name);
  // merge-reports exposes an empty list: a real run always selects at least one project.
  if (input.filteredProjects && input.filteredProjects.length > 0) {
    const running = withDependencies(input.filteredProjects, input.projects);
    return all.some((name) => !running.has(name));
  }
  if (!command?.options.has('--project')) return false;
  const running = new Set(input.runProjects);
  return all.some((name) => !running.has(name));
}

export function detectScopeReasons(input: ScopeInput): ScopeReason[] {
  const command = parseTestCommand(input.argv);
  const reasons = new Set<ScopeReason>();
  const has = (...names: string[]): boolean => names.some((name) => command?.options.has(name));

  if (command && command.filters.length > 0) reasons.add('file-filter');
  if (input.configGrep || has('-g', '--grep', '--grep-invert')) reasons.add('grep');
  if (hasProjectFilter(input, command)) reasons.add('project-filter');
  if (has('--last-failed')) reasons.add('last-failed');
  if (has('--only-changed')) reasons.add('only-changed');
  if (has('--test-list', '--test-list-invert')) reasons.add('test-list');
  if (input.only) reasons.add('only');
  if (input.shard) reasons.add('shard');
  // `--list` runs nothing: the report lists tests without results.
  if (has('--list')) reasons.add('list');

  return SCOPE_REASONS.filter((reason) => reasons.has(reason));
}

export const SCOPE_ENV = 'LOUPE_RUN_SCOPE';

/** Validates the LOUPE_RUN_SCOPE value; null when unset or empty. Throws on anything else than full / partial. */
export function parseScopeOverride(value: string | undefined): RunScope | null {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') return null;
  if (trimmed === 'full' || trimmed === 'partial') return trimmed;
  throw new Error(`Loupe: invalid ${SCOPE_ENV}=${JSON.stringify(value)}. Expected "full" or "partial".`);
}

/**
 * Final scope: the override wins. A forced `full` has no reasons; a forced
 * `partial` reports 'env' followed by whatever was detected.
 */
export function resolveScope(
  detected: readonly ScopeReason[],
  override: RunScope | null,
): { scope: RunScope; scopeReasons: ScopeReason[] } {
  if (override === 'full') return { scope: 'full', scopeReasons: [] };
  if (override === 'partial') return { scope: 'partial', scopeReasons: ['env', ...detected] };
  return { scope: detected.length > 0 ? 'partial' : 'full', scopeReasons: [...detected] };
}
