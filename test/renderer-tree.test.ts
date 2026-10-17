import { describe, expect, it } from 'vitest';
import type { LoupeReport, Outcome, Project, TestCase } from '../src/schema/v1.js';
import {
  UNNAMED_PROJECT,
  ancestorKeys,
  buildTree,
  groupKeys,
  testKey,
  visibleRows,
  type GroupNode,
  type TreeNode,
} from '../src/renderer/tree.js';

type Input = Pick<LoupeReport, 'projects' | 'tests'>;

let nextLine = 1;

function makeTest(fields: Partial<TestCase> & { title: string }): TestCase {
  const line = fields.line ?? nextLine++;
  return {
    id: `${fields.project ?? 'p'}|${fields.file ?? 'a.spec.ts'}|${[...(fields.suitePath ?? []), fields.title].join('>')}`,
    repeatEachIndex: 0,
    project: 'p',
    file: 'a.spec.ts',
    line,
    column: 3,
    suitePath: [],
    tags: [],
    annotations: [],
    outcome: 'passed',
    expectedStatus: 'passed',
    durationMs: 1,
    dimensions: {},
    category: null,
    errorSignature: null,
    attempts: [],
    ...fields,
  };
}

function project(name: string): Project {
  return { name, testDir: '.', retries: 0, timeoutMs: 30_000, stats: { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0 } };
}

/** Compact view of the tree: labels and outcomes, nested. */
function shape(nodes: readonly TreeNode[]): unknown[] {
  return nodes.map((node) =>
    node.kind === 'test' ? `${node.title} [${node.outcome}]` : { [`${node.kind}: ${node.labels.join(' › ')}`]: shape(node.children) },
  );
}

function group(nodes: readonly TreeNode[], index = 0): GroupNode {
  const node = nodes[index];
  if (!node || node.kind === 'test') throw new Error('not a group');
  return node;
}

describe('buildTree', () => {
  it('groups by project, file and describe blocks', () => {
    const input: Input = {
      projects: [project('chromium'), project('firefox')],
      tests: [
        makeTest({ project: 'chromium', file: 'b.spec.ts', title: 'b1' }),
        makeTest({ project: 'chromium', file: 'a.spec.ts', suitePath: ['login'], title: 'ok' }),
        makeTest({ project: 'chromium', file: 'a.spec.ts', suitePath: ['logout'], title: 'ok' }),
        makeTest({ project: 'firefox', file: 'a.spec.ts', suitePath: ['login'], title: 'ok' }),
      ],
    };
    expect(shape(buildTree(input))).toEqual([
      {
        'project: chromium': [
          { 'file: a.spec.ts': [{ 'suite: login': ['ok [passed]'] }, { 'suite: logout': ['ok [passed]'] }] },
          { 'file: b.spec.ts': ['b1 [passed]'] },
        ],
      },
      { 'project: firefox': [{ 'file: a.spec.ts › login': ['ok [passed]'] }] },
    ]);
  });

  it('follows the report project order and leaves out projects without tests', () => {
    const input: Input = {
      projects: [project('zeta'), project('empty'), project('alpha')],
      tests: [makeTest({ project: 'alpha', title: 'a' }), makeTest({ project: 'zeta', title: 'z' })],
    };
    expect(buildTree(input).map((node) => node.labels)).toEqual([['zeta'], ['alpha']]);
  });

  it('keeps tests of a project missing from the project list, and labels the unnamed project', () => {
    const input: Input = { projects: [], tests: [makeTest({ project: '', title: 'a' }), makeTest({ project: 'ghost', title: 'b' })] };
    expect(buildTree(input).map((node) => node.labels)).toEqual([[UNNAMED_PROJECT], ['ghost']]);
  });

  it('flattens single-child describe levels into one node', () => {
    const input: Input = {
      projects: [project('p')],
      tests: [
        makeTest({ file: 'deep.spec.ts', suitePath: ['outer', 'middle', 'inner'], title: 't1' }),
        makeTest({ file: 'deep.spec.ts', suitePath: ['outer', 'middle', 'inner'], title: 't2' }),
      ],
    };
    const [root] = buildTree(input);
    expect(shape(root?.children ?? [])).toEqual([{ 'file: deep.spec.ts › outer › middle › inner': ['t1 [passed]', 't2 [passed]'] }]);
  });

  it('stops flattening where a level has several children', () => {
    const input: Input = {
      projects: [project('p')],
      tests: [
        makeTest({ suitePath: ['outer', 'left'], title: 'l' }),
        makeTest({ suitePath: ['outer', 'right'], title: 'r' }),
        makeTest({ suitePath: ['outer'], title: 'direct' }),
      ],
    };
    expect(shape(group(buildTree(input)).children)).toEqual([
      { 'file: a.spec.ts › outer': [{ 'suite: left': ['l [passed]'] }, { 'suite: right': ['r [passed]'] }, 'direct [passed]'] },
    ]);
  });

  it('never merges a project with its only file, nor a test into its parent', () => {
    const input: Input = { projects: [project('p')], tests: [makeTest({ file: 'only.spec.ts', suitePath: ['suite'], title: 'alone' })] };
    expect(shape(buildTree(input))).toEqual([{ 'project: p': [{ 'file: only.spec.ts › suite': ['alone [passed]'] }] }]);
  });

  it('sorts files by path and keeps the declaration order inside a file', () => {
    const input: Input = {
      projects: [project('p')],
      tests: [
        makeTest({ file: 'z.spec.ts', title: 'z', line: 1 }),
        makeTest({ file: 'a.spec.ts', title: 'third', line: 30 }),
        makeTest({ file: 'a.spec.ts', suitePath: ['block'], title: 'second', line: 20 }),
        makeTest({ file: 'a.spec.ts', title: 'first', line: 10 }),
      ],
    };
    expect(shape(group(buildTree(input)).children)).toEqual([
      { 'file: a.spec.ts': ['first [passed]', { 'suite: block': ['second [passed]'] }, 'third [passed]'] },
      { 'file: z.spec.ts': ['z [passed]'] },
    ]);
  });

  it('counts outcomes on every group', () => {
    const outcomes: Outcome[] = ['passed', 'failed', 'failed', 'flaky', 'skipped'];
    const input: Input = {
      projects: [project('p')],
      tests: [
        ...outcomes.map((outcome, index) => makeTest({ file: 'a.spec.ts', suitePath: ['s'], title: `t${index}`, outcome })),
        makeTest({ file: 'b.spec.ts', title: 'other', outcome: 'failed' }),
      ],
    };
    const [root] = buildTree(input);
    expect(root?.counts).toEqual({ total: 6, passed: 1, failed: 3, flaky: 1, skipped: 1 });
    expect(group(root?.children ?? []).counts).toEqual({ total: 5, passed: 1, failed: 2, flaky: 1, skipped: 1 });
    expect(group(root?.children ?? [], 1).counts).toEqual({ total: 1, passed: 0, failed: 1, flaky: 0, skipped: 0 });
  });

  it('keeps the test status from the model', () => {
    const outcomes: Outcome[] = ['passed', 'failed', 'flaky', 'skipped'];
    const input: Input = { projects: [project('p')], tests: outcomes.map((outcome) => makeTest({ title: outcome, outcome })) };
    expect(shape(group(buildTree(input)).children)).toEqual([
      { 'file: a.spec.ts': ['passed [passed]', 'failed [failed]', 'flaky [flaky]', 'skipped [skipped]'] },
    ]);
  });

  it('gives each repetition of a --repeat-each test its own leaf', () => {
    const base = makeTest({ title: 'repeated', line: 5 });
    const input: Input = { projects: [project('p')], tests: [{ ...base, repeatEachIndex: 1 }, base] };
    const file = group(group(buildTree(input)).children);
    expect(file.children.map((node) => node.key)).toEqual([testKey(base.id, 0), testKey(base.id, 1)]);
  });

  it('gives unique keys, even when titles repeat across levels', () => {
    const input: Input = {
      projects: [project('p'), project('q')],
      tests: [
        makeTest({ project: 'p', file: 'x', suitePath: ['x'], title: 'x' }),
        makeTest({ project: 'p', file: 'x', suitePath: ['x', 'x'], title: 'x' }),
        makeTest({ project: 'q', file: 'x', suitePath: ['x'], title: 'x' }),
      ],
    };
    const keys: string[] = [];
    const collect = (nodes: readonly TreeNode[]): void => {
      for (const node of nodes) {
        keys.push(node.key);
        if (node.kind !== 'test') collect(node.children);
      }
    };
    collect(buildTree(input));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('groups files by folder, below the common prefix, folders before files', () => {
    const input: Input = {
      projects: [project('p')],
      tests: [
        makeTest({ file: 'tests/e2e/root.spec.ts', title: 'r' }),
        makeTest({ file: 'tests/e2e/checkout/cart.spec.ts', title: 'c1' }),
        makeTest({ file: 'tests/e2e/checkout/pay.spec.ts', title: 'c2' }),
        makeTest({ file: 'tests/e2e/api/users.spec.ts', title: 'u' }),
      ],
    };
    expect(shape(group(buildTree(input)).children)).toEqual([
      { 'folder: api': [{ 'file: users.spec.ts': ['u [passed]'] }] },
      { 'folder: checkout': [{ 'file: cart.spec.ts': ['c1 [passed]'] }, { 'file: pay.spec.ts': ['c2 [passed]'] }] },
      { 'file: root.spec.ts': ['r [passed]'] },
    ]);
  });

  it('merges single-child folders into one node, never a folder with its file', () => {
    const input: Input = {
      projects: [project('p')],
      tests: [makeTest({ file: 'tests/api/users/v2/list.spec.ts', title: 'l' }), makeTest({ file: 'tests/ui/home.spec.ts', title: 'h' })],
    };
    const [root] = buildTree(input);
    expect(shape(root?.children ?? [])).toEqual([
      { 'folder: api/users/v2': [{ 'file: list.spec.ts': ['l [passed]'] }] },
      { 'folder: ui': [{ 'file: home.spec.ts': ['h [passed]'] }] },
    ]);
    const folder = group(root?.children ?? []);
    expect(folder.path).toBe('tests/api/users/v2');
    expect(group(folder.children).path).toBe('tests/api/users/v2/list.spec.ts');
  });

  it('uses the given prefix, so a filtered tree keeps the folders of the whole run', () => {
    const input: Input = { projects: [project('p')], tests: [makeTest({ file: 'tests/api/users.spec.ts', title: 'u' })] };
    expect(shape(group(buildTree(input)).children)).toEqual([{ 'file: users.spec.ts': ['u [passed]'] }]);
    expect(shape(group(buildTree(input, { prefix: 'tests/' })).children)).toEqual([{ 'folder: api': [{ 'file: users.spec.ts': ['u [passed]'] }] }]);
  });

  it('keeps folder keys stable when filtering changes the merged folders', () => {
    const tests = [makeTest({ file: 'tests/api/a.spec.ts', title: 'a' }), makeTest({ file: 'tests/ui/b.spec.ts', title: 'b' })];
    const full = buildTree({ projects: [project('p')], tests }, { prefix: 'tests/' });
    const filtered = buildTree({ projects: [project('p')], tests: [tests[0] as TestCase] }, { prefix: 'tests/' });
    expect(group(group(filtered).children).key).toBe(group(group(full).children).key);
  });

  it('returns no root for a run without tests', () => {
    expect(buildTree({ projects: [project('p')], tests: [] })).toEqual([]);
  });
});

describe('visibleRows', () => {
  const input: Input = {
    projects: [project('p')],
    tests: [
      makeTest({ file: 'a.spec.ts', suitePath: ['s1'], title: 'one' }),
      makeTest({ file: 'a.spec.ts', suitePath: ['s2'], title: 'two' }),
      makeTest({ file: 'b.spec.ts', title: 'three' }),
    ],
  };
  const roots = buildTree(input);
  const root = group(roots);
  const fileA = group(root.children);

  it('shows only the roots when nothing is expanded', () => {
    expect(visibleRows(roots, new Set()).map((row) => row.node.key)).toEqual([root.key]);
  });

  it('descends into expanded groups only, with level, parent and position', () => {
    const rows = visibleRows(roots, new Set([root.key, fileA.key]));
    expect(rows.map((row) => [row.level, row.position, row.siblings, row.parentKey])).toEqual([
      [1, 1, 1, null],
      [2, 1, 2, root.key],
      [3, 1, 2, fileA.key],
      [3, 2, 2, fileA.key],
      [2, 2, 2, root.key],
    ]);
  });

  it('ignores expanded groups below a collapsed one', () => {
    expect(visibleRows(roots, new Set([fileA.key]))).toHaveLength(1);
  });

  it('stays cheap with thousands of tests when groups are collapsed', () => {
    const big: Input = {
      projects: [project('p')],
      tests: Array.from({ length: 5000 }, (_, index) =>
        makeTest({ file: `f${index % 50}.spec.ts`, suitePath: [`s${index % 7}`], title: `t${index}` }),
      ),
    };
    const bigRoots = buildTree(big);
    expect(group(bigRoots).counts.total).toBe(5000);
    expect(visibleRows(bigRoots, new Set([group(bigRoots).key]))).toHaveLength(51);
    expect(visibleRows(bigRoots, new Set(groupKeys(bigRoots)))).toHaveLength(1 + 50 + 50 * 7 + 5000);
  });
});

describe('ancestorKeys', () => {
  const test = makeTest({ file: 'a.spec.ts', suitePath: ['outer', 'inner'], title: 'target' });
  const input: Input = { projects: [project('p')], tests: [test, makeTest({ file: 'a.spec.ts', suitePath: ['outer'], title: 'sibling' })] };
  const roots = buildTree(input);

  it('returns the groups to expand to reveal a test, outermost first', () => {
    const root = group(roots);
    const file = group(root.children);
    const inner = group(file.children);
    expect(ancestorKeys(roots, testKey(test.id, 0))).toEqual([root.key, file.key, inner.key]);
  });

  it('returns null for a test that is not in the tree', () => {
    expect(ancestorKeys(roots, testKey('missing', 0))).toBeNull();
  });
});
