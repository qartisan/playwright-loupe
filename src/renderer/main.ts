import { DEFAULT_RENDERER_SETTINGS, type RendererSettings } from '../core/inject.js';
import { OUTCOMES, type LoupeReport, type TestCase } from '../schema/v1.js';
import './styles.css';

// Skeleton renderer for schema v1. The UI stack is still an open question, so
// this is intentionally plain DOM code.

function readJson<T>(id: string): T {
  return JSON.parse(document.getElementById(id)?.textContent ?? '') as T;
}

function readSettings(): RendererSettings {
  try {
    return { ...DEFAULT_RENDERER_SETTINGS, ...readJson<Partial<RendererSettings>>('loupe-settings') };
  } catch {
    return DEFAULT_RENDERER_SETTINGS;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; text?: string } = {},
  children: Node[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  node.append(...children);
  return node;
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function renderSummary(report: LoupeReport, title: string): HTMLElement {
  const { run } = report;
  const counts = OUTCOMES.map((outcome) =>
    el('li', { className: `count status-${outcome}` }, [
      el('span', { className: 'count-value', text: String(run.stats[outcome]) }),
      el('span', { className: 'count-label', text: outcome }),
    ]),
  );
  const details = [
    `${run.stats.total} tests`,
    formatDuration(run.durationMs),
    `${run.scope} run`,
    `Playwright ${run.playwrightVersion}`,
    ...(run.environment.name ? [run.environment.name] : []),
    ...(run.git.commit ? [run.git.commit.slice(0, 8)] : []),
  ];

  return el('header', { className: 'summary' }, [
    el('h1', { text: title }),
    el('p', { className: 'meta' }, [
      el('span', { className: `badge status-${run.status}`, text: run.status }),
      document.createTextNode(` ${details.join(' · ')}`),
    ]),
    el('ul', { className: 'counts' }, counts),
  ]);
}

/** A node of the tree rebuilt from the flat test list: file, then describe blocks. */
interface SuiteNode {
  title: string;
  suites: Map<string, SuiteNode>;
  tests: TestCase[];
}

function buildTree(tests: TestCase[]): SuiteNode {
  const root: SuiteNode = { title: '', suites: new Map(), tests: [] };
  for (const test of tests) {
    let node = root;
    for (const title of [test.file, ...test.suitePath]) {
      let child = node.suites.get(title);
      if (!child) {
        child = { title, suites: new Map(), tests: [] };
        node.suites.set(title, child);
      }
      node = child;
    }
    node.tests.push(test);
  }
  return root;
}

function renderTest(test: TestCase): HTMLElement {
  return el('li', { className: 'test' }, [
    el('span', { className: `badge status-${test.outcome}`, text: test.outcome }),
    el('span', { className: 'title', text: test.title }),
    el('span', { className: 'attempts', text: test.attempts.length > 1 ? `${test.attempts.length} attempts` : '' }),
  ]);
}

function renderSuite(node: SuiteNode, depth: number): HTMLElement {
  return el('li', { className: `suite depth-${Math.min(depth, 3)}` }, [
    el('span', { className: depth === 0 ? 'file' : 'suite-title', text: node.title }),
    el('ul', { className: 'tests' }, [
      ...[...node.suites.values()].map((child) => renderSuite(child, depth + 1)),
      ...node.tests.map(renderTest),
    ]),
  ]);
}

function renderProject(name: string, tests: TestCase[]): HTMLElement {
  const tree = buildTree(tests);
  return el('section', { className: 'project' }, [
    el('h2', { text: `${name || '(no project)'} (${tests.length})` }),
    el('ul', { className: 'suites' }, [...tree.suites.values()].map((node) => renderSuite(node, 0))),
  ]);
}

function render(root: HTMLElement): void {
  const settings = readSettings();
  let report: LoupeReport;
  try {
    report = readJson<LoupeReport>('loupe-data');
  } catch {
    root.append(el('p', { className: 'error', text: 'Loupe: could not read report data.' }));
    return;
  }
  if (report.schemaVersion !== 1) {
    root.append(el('p', { className: 'error', text: `Loupe: unsupported schema version ${String(report.schemaVersion)}.` }));
    return;
  }

  document.title = settings.title;
  const byProject = new Map<string, TestCase[]>(report.projects.map((project) => [project.name, []]));
  for (const test of report.tests) {
    byProject.set(test.project, [...(byProject.get(test.project) ?? []), test]);
  }
  root.append(
    renderSummary(report, settings.title),
    ...[...byProject].map(([name, tests]) => renderProject(name, tests)),
  );
}

render(document.getElementById('app') ?? document.body);
