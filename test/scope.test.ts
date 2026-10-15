import { describe, expect, it } from 'vitest';
import {
  detectScopeReasons,
  parseScopeOverride,
  parseTestCommand,
  resolveScope,
  type ScopeInput,
} from '../src/core/scope.js';

const BIN = ['/usr/bin/node', '/repo/node_modules/.bin/playwright'];

const PROJECTS = [
  { name: 'setup', dependencies: [], teardown: 'cleanup' },
  { name: 'cleanup', dependencies: [] },
  { name: 'chromium', dependencies: ['setup'] },
  { name: 'firefox', dependencies: ['setup'] },
];
const ALL = PROJECTS.map((project) => project.name);

function input(args: string[], overrides: Partial<ScopeInput> = {}): ScopeInput {
  return {
    argv: [...BIN, ...args],
    configGrep: false,
    shard: false,
    projects: PROJECTS,
    filteredProjects: ALL,
    nonDefaultProjects: [],
    runProjects: ALL,
    only: false,
    ...overrides,
  };
}

describe('parseTestCommand', () => {
  it('returns null for other commands', () => {
    expect(parseTestCommand([...BIN, 'merge-reports', 'blobs'])).toBeNull();
    expect(parseTestCommand(BIN)).toBeNull();
  });

  it('collects positional filters and skips option values', () => {
    const command = parseTestCommand([...BIN, 'test', '-c', 'e2e.config.ts', '--workers', '4', 'login', 'cart.spec.ts:12']);
    expect(command?.filters).toEqual(['login', 'cart.spec.ts:12']);
    expect([...(command?.options ?? [])]).toEqual(['-c', '--workers']);
  });

  it('handles --option=value and attached short values', () => {
    const command = parseTestCommand([...BIN, 'test', '--grep=@smoke', '-gcheckout', '--reporter=list']);
    expect(command?.filters).toEqual([]);
    expect(command?.options).toEqual(new Set(['--grep', '-g', '--reporter']));
  });

  it('treats unknown options as flags', () => {
    expect(parseTestCommand([...BIN, 'test', '--headed', 'a.spec.ts'])?.filters).toEqual(['a.spec.ts']);
  });

  it('gives optional values to --only-changed and --update-snapshots like commander does', () => {
    expect(parseTestCommand([...BIN, 'test', '--only-changed', 'main'])?.filters).toEqual([]);
    expect(parseTestCommand([...BIN, 'test', '--only-changed', '--headed', 'a.spec.ts'])?.filters).toEqual(['a.spec.ts']);
    expect(parseTestCommand([...BIN, 'test', '-u', 'all'])?.filters).toEqual([]);
  });

  it('gives --project every following value like commander does', () => {
    expect(parseTestCommand([...BIN, 'test', '--project', 'a', 'b', '--headed', 'c.spec.ts'])?.filters).toEqual(['c.spec.ts']);
    expect(parseTestCommand([...BIN, 'test', '--project', 'a', 'b'])?.filters).toEqual([]);
    // The = form takes a single value.
    expect(parseTestCommand([...BIN, 'test', '--project=a', 'b.spec.ts'])?.filters).toEqual(['b.spec.ts']);
    expect(parseTestCommand([...BIN, 'test', '--project', 'a', '--', 'b.spec.ts'])?.filters).toEqual(['b.spec.ts']);
  });

  it('treats everything after -- as filters', () => {
    expect(parseTestCommand([...BIN, 'test', '--', '--weird-file.spec.ts'])?.filters).toEqual(['--weird-file.spec.ts']);
  });
});

describe('detectScopeReasons', () => {
  it('reports nothing for a plain run', () => {
    expect(detectScopeReasons(input(['test']))).toEqual([]);
    expect(detectScopeReasons(input(['test', '--workers', '2', '--retries=2', '--reporter', 'list', '--headed']))).toEqual([]);
  });

  it('detects file filters', () => {
    expect(detectScopeReasons(input(['test', 'tests/login.spec.ts']))).toEqual(['file-filter']);
    expect(detectScopeReasons(input(['test', 'login:12']))).toEqual(['file-filter']);
  });

  it('detects CLI grep and grep-invert', () => {
    expect(detectScopeReasons(input(['test', '-g', '@smoke']))).toEqual(['grep']);
    expect(detectScopeReasons(input(['test', '--grep-invert', '@slow']))).toEqual(['grep']);
  });

  it('detects a grep from the config file', () => {
    expect(detectScopeReasons(input(['test'], { configGrep: true }))).toEqual(['grep']);
  });

  it('detects a project filter from filteredProjects, dependencies and teardowns included', () => {
    // chromium pulls setup, which pulls its teardown: firefox is left out.
    expect(detectScopeReasons(input(['test', '--project', 'chromium'], { filteredProjects: ['chromium'] }))).toEqual([
      'project-filter',
    ]);
    // Every project runs: no filter in effect.
    expect(
      detectScopeReasons(input(['test', '--project', 'chromium', '--project', 'firefox'], {
        filteredProjects: ['chromium', 'firefox'],
      })),
    ).toEqual([]);
  });

  it('does not count dependencies and teardowns as running under --no-deps', () => {
    const projects = [
      { name: 'setup', dependencies: [], teardown: 'cleanup' },
      { name: 'cleanup', dependencies: [] },
      { name: 'chromium', dependencies: ['setup'] },
    ];
    // Without --no-deps, chromium pulls setup and cleanup: every project runs.
    expect(detectScopeReasons(input(['test', '--project', 'chromium'], { projects, filteredProjects: ['chromium'] }))).toEqual(
      [],
    );
    // What Playwright 1.64 passes: dependencies unchanged, filteredProjects without them.
    expect(
      detectScopeReasons(input(['test', '--project', 'chromium', '--no-deps'], { projects, filteredProjects: ['chromium'] })),
    ).toEqual(['project-filter']);
    // Before 1.64, the projects present in the run already leave them out.
    expect(
      detectScopeReasons(input(['test', '--project', 'chromium', '--no-deps'], {
        projects,
        filteredProjects: undefined,
        runProjects: ['chromium'],
      })),
    ).toEqual(['project-filter']);
    // --no-deps alone: every project is selected and runs.
    expect(detectScopeReasons(input(['test', '--no-deps'], { projects, filteredProjects: ['setup', 'cleanup', 'chromium'] }))).toEqual(
      [],
    );
  });

  it('takes the default projects as the reference for a full run', () => {
    const projects = [...PROJECTS, { name: 'nightly', dependencies: ['setup'] }];
    const base = { projects, nonDefaultProjects: ['nightly'] };
    // What Playwright 1.64 passes for a plain run: nightly is not selected.
    expect(detectScopeReasons(input(['test'], { ...base, filteredProjects: ALL }))).toEqual([]);
    expect(detectScopeReasons(input(['test', '--project', 'nightly'], { ...base, filteredProjects: ['nightly'] }))).toEqual([
      'project-filter',
    ]);
    expect(
      detectScopeReasons(input(['test', '--project', 'chromium', 'firefox', 'nightly'], {
        ...base,
        filteredProjects: ['chromium', 'firefox', 'nightly'],
      })),
    ).toEqual([]);
  });

  it('treats a plain run as covering the default projects when their flags are unavailable', () => {
    const projects = [...PROJECTS, { name: 'nightly', dependencies: [] }];
    const base = { projects, nonDefaultProjects: undefined };
    expect(detectScopeReasons(input(['test'], { ...base, filteredProjects: ALL }))).toEqual([]);
    // With --project, every configured project is the reference.
    expect(detectScopeReasons(input(['test', '--project', 'chromium', 'firefox'], { ...base, filteredProjects: ['chromium', 'firefox'] }))).toEqual(
      ['project-filter'],
    );
  });

  it('falls back to the projects present in the run when filteredProjects is unavailable', () => {
    const base = { filteredProjects: undefined };
    expect(
      detectScopeReasons(input(['test', '--project', 'chromium'], { ...base, runProjects: ['setup', 'cleanup', 'chromium'] })),
    ).toEqual(['project-filter']);
    expect(detectScopeReasons(input(['test', '--project', '*'], { ...base, runProjects: ALL }))).toEqual([]);
    // Without --project, missing projects (e.g. pruned by grep) are not a project filter.
    expect(detectScopeReasons(input(['test'], { ...base, runProjects: ['chromium'] }))).toEqual([]);
  });

  it('detects --last-failed, --only-changed and test lists', () => {
    expect(detectScopeReasons(input(['test', '--last-failed']))).toEqual(['last-failed']);
    expect(detectScopeReasons(input(['test', '--only-changed=main']))).toEqual(['only-changed']);
    expect(detectScopeReasons(input(['test', '--test-list', 'list.txt']))).toEqual(['test-list']);
  });

  it('detects test.only and sharding', () => {
    expect(detectScopeReasons(input(['test'], { only: true }))).toEqual(['only']);
    expect(detectScopeReasons(input(['test', '--shard', '1/2'], { shard: true }))).toEqual(['shard']);
  });

  it('detects a listing that runs nothing', () => {
    expect(detectScopeReasons(input(['test', '--list']))).toEqual(['list']);
  });

  it('reports every reason in a stable order', () => {
    expect(
      detectScopeReasons(input(['test', '--last-failed', '-g', 'x', 'a.spec.ts'], { only: true, shard: true })),
    ).toEqual(['file-filter', 'grep', 'last-failed', 'only', 'shard']);
  });

  it('ignores the command line of merge-reports', () => {
    expect(detectScopeReasons(input(['merge-reports', '--reporter', 'x', 'blobs']))).toEqual([]);
  });

  it('treats the empty filteredProjects of merge-reports as unknown', () => {
    // What Playwright 1.64 passes to reporters under merge-reports.
    expect(detectScopeReasons({ ...input([]), argv: [], filteredProjects: [], runProjects: ['chromium'] })).toEqual([]);
  });
});

describe('scope override', () => {
  it('accepts full and partial, ignores empty values', () => {
    expect(parseScopeOverride(undefined)).toBeNull();
    expect(parseScopeOverride('')).toBeNull();
    expect(parseScopeOverride(' full ')).toBe('full');
    expect(parseScopeOverride('partial')).toBe('partial');
  });

  it('rejects anything else with an explicit message', () => {
    expect(() => parseScopeOverride('Full')).toThrow('Loupe: invalid LOUPE_RUN_SCOPE="Full". Expected "full" or "partial".');
    expect(() => parseScopeOverride('yes')).toThrow(/LOUPE_RUN_SCOPE/);
  });

  it('defaults to full when nothing was detected', () => {
    expect(resolveScope([], null)).toEqual({ scope: 'full', scopeReasons: [] });
  });

  it('is partial when something was detected', () => {
    expect(resolveScope(['grep'], null)).toEqual({ scope: 'partial', scopeReasons: ['grep'] });
  });

  it('lets the override win', () => {
    expect(resolveScope(['grep'], 'full')).toEqual({ scope: 'full', scopeReasons: [] });
    expect(resolveScope([], 'partial')).toEqual({ scope: 'partial', scopeReasons: ['env'] });
    expect(resolveScope(['grep'], 'partial')).toEqual({ scope: 'partial', scopeReasons: ['env', 'grep'] });
  });
});
