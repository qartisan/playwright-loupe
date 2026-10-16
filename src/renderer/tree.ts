import type { LoupeReport, Outcome, Stats, TestCase } from '../schema/v1.js';

/**
 * Sidebar tree: projects → files → describe blocks → tests, built from the
 * flat test list of the report. Pure functions, no DOM: unit-tested in Node.
 */

export type GroupKind = 'project' | 'file' | 'suite';

export interface GroupNode {
  kind: GroupKind;
  /** Unique and stable across renders: used for expansion state and as the DOM key. */
  key: string;
  /** One label, or several when single-child levels were flattened into this node. */
  labels: string[];
  children: TreeNode[];
  counts: Stats;
  /** Smallest declaration line of the tests below, to keep the source order. */
  line: number;
}

export interface TestNode {
  kind: 'test';
  key: string;
  testId: string;
  repeatEachIndex: number;
  title: string;
  outcome: Outcome;
  line: number;
  column: number;
}

export type TreeNode = GroupNode | TestNode;

/** Label of a project without a name (Playwright's default project). */
export const UNNAMED_PROJECT = '(unnamed project)';

const SEPARATOR = '\u0000';

function emptyCounts(): Stats {
  return { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0 };
}

export function testKey(testId: string, repeatEachIndex: number): string {
  return `t${SEPARATOR}${testId}${SEPARATOR}${repeatEachIndex}`;
}

/** Tree key of a project node. */
export function projectKey(name: string): string {
  return `p${SEPARATOR}${name}`;
}

function group(kind: GroupKind, key: string, label: string): GroupNode {
  return { kind, key, labels: [label], children: [], counts: emptyCounts(), line: Number.POSITIVE_INFINITY };
}

function compareNodes(a: TreeNode, b: TreeNode): number {
  if (a.line !== b.line) return a.line - b.line;
  if (a.kind === 'test' && b.kind === 'test') return a.column - b.column || a.repeatEachIndex - b.repeatEachIndex;
  // Groups before tests on the same line, then by label.
  if (a.kind !== b.kind) return a.kind === 'test' ? 1 : -1;
  return label(a).localeCompare(label(b));
}

function label(node: TreeNode): string {
  return node.kind === 'test' ? node.title : node.labels.join(' › ');
}

/** Adds counts and the first line bottom-up, sorts children; files are sorted by path. */
function finalize(node: GroupNode): void {
  for (const child of node.children) {
    if (child.kind === 'test') {
      node.counts.total += 1;
      node.counts[child.outcome] += 1;
    } else {
      finalize(child);
      for (const outcome of ['total', 'passed', 'failed', 'flaky', 'skipped'] as const) {
        node.counts[outcome] += child.counts[outcome];
      }
    }
    node.line = Math.min(node.line, child.line);
  }
  if (node.kind === 'project') {
    node.children.sort((a, b) => label(a).localeCompare(label(b)));
  } else {
    node.children.sort(compareNodes);
  }
}

/**
 * Merges a file or describe node with its only child when that child is a
 * describe block: `a.spec.ts` › `suite` becomes one node. Project nodes are
 * never merged (projects are always visible) and tests are never merged into
 * their parent, so a leaf always shows the test title alone.
 */
function flatten(node: GroupNode): GroupNode {
  let current = node;
  for (;;) {
    const only = current.children.length === 1 ? current.children[0] : undefined;
    if (current.kind === 'project' || only?.kind !== 'suite') break;
    current = { ...current, labels: [...current.labels, ...only.labels], children: only.children };
  }
  return { ...current, children: current.children.map((child) => (child.kind === 'test' ? child : flatten(child))) };
}

/**
 * Builds the sidebar tree. Projects follow the report's project order and
 * projects without tests are left out; files are sorted by path; describe
 * blocks and tests follow their declaration order.
 */
export function buildTree(report: Pick<LoupeReport, 'projects' | 'tests'>): GroupNode[] {
  const projects = new Map<string, GroupNode>();
  for (const project of report.projects) {
    projects.set(project.name, group('project', projectKey(project.name), project.name || UNNAMED_PROJECT));
  }
  // Groups by key, so describe blocks of the same name in the same parent are merged, as in Playwright.
  const groups = new Map<string, GroupNode>();

  for (const test of report.tests) {
    let parent = projects.get(test.project);
    if (!parent) {
      parent = group('project', projectKey(test.project), test.project || UNNAMED_PROJECT);
      projects.set(test.project, parent);
    }
    const levels: Array<[GroupKind, string]> = [['file', test.file], ...test.suitePath.map((title): [GroupKind, string] => ['suite', title])];
    for (const [kind, title] of levels) {
      const key = `${parent.key}${SEPARATOR}${kind === 'file' ? 'f' : 's'}${SEPARATOR}${title}`;
      let child = groups.get(key);
      if (!child) {
        child = group(kind, key, title);
        groups.set(key, child);
        parent.children.push(child);
      }
      parent = child;
    }
    parent.children.push(testNode(test));
  }

  const roots = [...projects.values()].filter((project) => project.children.length > 0);
  for (const root of roots) finalize(root);
  return roots.map(flatten);
}

function testNode(test: TestCase): TestNode {
  return {
    kind: 'test',
    key: testKey(test.id, test.repeatEachIndex),
    testId: test.id,
    repeatEachIndex: test.repeatEachIndex,
    title: test.title,
    outcome: test.outcome,
    line: test.line,
    column: test.column,
  };
}

/** A row of the rendered tree: only nodes whose ancestors are all expanded. */
export interface VisibleRow {
  node: TreeNode;
  /** 1 for projects. */
  level: number;
  parentKey: string | null;
  /** 1-based position among its siblings, and their number (for aria-posinset / aria-setsize). */
  position: number;
  siblings: number;
}

/**
 * The rows to render, in order. Children of collapsed nodes are never
 * visited, so the cost follows what is visible, not the size of the suite.
 */
export function visibleRows(roots: readonly TreeNode[], expanded: ReadonlySet<string>): VisibleRow[] {
  const rows: VisibleRow[] = [];
  const visit = (nodes: readonly TreeNode[], level: number, parentKey: string | null): void => {
    nodes.forEach((node, index) => {
      rows.push({ node, level, parentKey, position: index + 1, siblings: nodes.length });
      if (node.kind !== 'test' && expanded.has(node.key)) visit(node.children, level + 1, node.key);
    });
  };
  visit(roots, 1, null);
  return rows;
}

/** Keys of the groups containing a test, outermost first; null when the test is not in the tree. */
export function ancestorKeys(roots: readonly TreeNode[], key: string): string[] | null {
  for (const node of roots) {
    if (node.key === key) return [];
    if (node.kind === 'test') continue;
    const below = ancestorKeys(node.children, key);
    if (below) return [node.key, ...below];
  }
  return null;
}

/** Every group key: for "expand all". */
export function groupKeys(roots: readonly TreeNode[]): string[] {
  return roots.flatMap((node) => (node.kind === 'test' ? [] : [node.key, ...groupKeys(node.children)]));
}
