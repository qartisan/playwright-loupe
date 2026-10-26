import type { LoupeReport, Outcome, Stats, TestCase } from '../schema/v1.js';
import { commonDirectoryPrefix, stripPrefix, toPosix } from './paths.js';

/**
 * Sidebar tree: projects → folders → files → describe blocks → tests, built
 * from the flat test list of the report. In each project, the directory
 * prefix shared by every file of that project is left out, so a project with
 * its own test directory does not repeat it as a folder. Pure functions, no
 * DOM: unit-tested in Node.
 */

export type GroupKind = 'project' | 'folder' | 'file' | 'suite';

export interface GroupNode {
  kind: GroupKind;
  /** Unique and stable across renders: used for expansion state and as the DOM key. */
  key: string;
  /**
   * One label, or several when describe blocks were flattened into this node.
   * A folder has one label, `api/users` when single-child folders were merged.
   */
  labels: string[];
  /** Folders and files: the full path, common prefix included (POSIX separators). */
  path?: string;
  /** Projects: the directory prefix left out of its folders and files, with its trailing `/`; empty when none. */
  prefix?: string;
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

const KEY_LETTERS: Record<GroupKind, string> = { project: 'p', folder: 'd', file: 'f', suite: 's' };

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

function group(kind: GroupKind, key: string, label: string, path?: string): GroupNode {
  const node: GroupNode = { kind, key, labels: [label], children: [], counts: emptyCounts(), line: Number.POSITIVE_INFINITY };
  if (path !== undefined) node.path = path;
  return node;
}

/** Projects and folders: folders first, then files, each by name. */
function compareEntries(a: TreeNode, b: TreeNode): number {
  if ((a.kind === 'folder') !== (b.kind === 'folder')) return a.kind === 'folder' ? -1 : 1;
  return label(a).localeCompare(label(b));
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

/** Adds counts and the first line bottom-up, sorts children; folders and files are sorted by name. */
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
  if (node.kind === 'project' || node.kind === 'folder') {
    node.children.sort(compareEntries);
  } else {
    node.children.sort(compareNodes);
  }
}

/**
 * Merges a file or describe node with its only child when that child is a
 * describe block: `a.spec.ts` › `suite` becomes one node. Likewise a folder
 * whose only child is a folder: `api` / `users` becomes `api/users`. Project
 * nodes are never merged (projects are always visible), files never merge
 * into their folder, and tests are never merged into their parent, so a leaf
 * always shows the test title alone.
 */
function flatten(node: GroupNode): GroupNode {
  let current = node;
  for (;;) {
    const only = current.children.length === 1 ? current.children[0] : undefined;
    if (current.kind === 'folder' && only?.kind === 'folder') {
      current = { ...only, key: current.key, labels: [`${current.labels.join('/')}/${only.labels.join('/')}`] };
      continue;
    }
    if (current.kind === 'project' || current.kind === 'folder' || only?.kind !== 'suite') break;
    current = { ...current, labels: [...current.labels, ...only.labels], children: only.children };
  }
  return { ...current, children: current.children.map((child) => (child.kind === 'test' ? child : flatten(child))) };
}

/**
 * Per project, the directory prefix shared by its files, with its trailing
 * `/` (see `commonDirectoryPrefix`): what its tree leaves out.
 */
export function projectPrefixes(tests: Iterable<Pick<TestCase, 'project' | 'file'>>): Map<string, string> {
  const files = new Map<string, string[]>();
  for (const test of tests) {
    const list = files.get(test.project);
    if (list) list.push(test.file);
    else files.set(test.project, [test.file]);
  }
  return new Map([...files].map(([project, list]) => [project, commonDirectoryPrefix(list)]));
}

export interface TreeOptions {
  /**
   * Per project, the directory prefix left out of its folders and files.
   * Defaults to `projectPrefixes(report.tests)`; pass the prefixes of the
   * whole run when building the tree of a filtered list, so folders do not
   * change with the filters. A project missing from the map keeps full paths.
   */
  prefixes?: ReadonlyMap<string, string>;
}

/**
 * Builds the sidebar tree. Projects follow the report's project order and
 * projects without tests are left out; folders, then files, are sorted by
 * name; describe blocks and tests follow their declaration order.
 */
export function buildTree(report: Pick<LoupeReport, 'projects' | 'tests'>, options: TreeOptions = {}): GroupNode[] {
  const prefixes = options.prefixes ?? projectPrefixes(report.tests);
  const projects = new Map<string, GroupNode>();
  const projectNode = (name: string): GroupNode => {
    const node = group('project', projectKey(name), name || UNNAMED_PROJECT);
    node.prefix = prefixes.get(name) ?? '';
    return node;
  };
  for (const project of report.projects) projects.set(project.name, projectNode(project.name));
  // Groups by key, so describe blocks of the same name in the same parent are merged, as in Playwright.
  const groups = new Map<string, GroupNode>();

  for (const test of report.tests) {
    let parent = projects.get(test.project);
    if (!parent) {
      parent = projectNode(test.project);
      projects.set(test.project, parent);
    }
    const prefix = parent.prefix ?? '';
    const relative = stripPrefix(test.file, prefix).split('/');
    const fileName = relative.pop() ?? test.file;
    const levels: Array<[GroupKind, string, string?]> = [
      ...relative.map((folder, index): [GroupKind, string, string] => ['folder', folder, `${prefix}${relative.slice(0, index + 1).join('/')}`]),
      ['file', fileName, toPosix(test.file)],
      ...test.suitePath.map((title): [GroupKind, string] => ['suite', title]),
    ];
    for (const [kind, title, path] of levels) {
      const key = `${parent.key}${SEPARATOR}${KEY_LETTERS[kind]}${SEPARATOR}${title}`;
      let child = groups.get(key);
      if (!child) {
        child = group(kind, key, title, path);
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
