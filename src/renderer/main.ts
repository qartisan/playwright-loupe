import type { PlaceholderReport, PlaceholderTest, PlaceholderTestStatus } from '../core/model.js';
import './styles.css';

// Skeleton renderer for the placeholder model (schemaVersion 0). The UI stack is
// still an open question, so this is intentionally plain DOM code.

const STATUSES: PlaceholderTestStatus[] = ['passed', 'failed', 'flaky', 'skipped'];

function readReport(): PlaceholderReport {
  const raw = document.getElementById('loupe-data')?.textContent ?? '';
  return JSON.parse(raw) as PlaceholderReport;
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

function renderSummary(report: PlaceholderReport): HTMLElement {
  const counts = STATUSES.map((status) => {
    const count = report.tests.filter((test) => test.status === status).length;
    return el('li', { className: `count status-${status}` }, [
      el('span', { className: 'count-value', text: String(count) }),
      el('span', { className: 'count-label', text: status }),
    ]);
  });

  return el('header', { className: 'summary' }, [
    el('h1', { text: report.run.title }),
    el('p', { className: 'meta' }, [
      el('span', { className: `badge status-${report.run.status}`, text: report.run.status }),
      document.createTextNode(
        ` ${report.tests.length} tests · ${formatDuration(report.run.duration)} · Playwright ${report.run.playwrightVersion}`,
      ),
    ]),
    el('ul', { className: 'counts' }, counts),
  ]);
}

function renderProject(name: string, tests: PlaceholderTest[]): HTMLElement {
  const rows = tests.map((test) =>
    el('li', { className: 'test' }, [
      el('span', { className: `badge status-${test.status}`, text: test.status }),
      el('span', { className: 'title', text: test.titlePath.join(' › ') }),
      el('span', { className: 'file', text: test.file }),
      el('span', { className: 'attempts', text: test.attempts > 1 ? `${test.attempts} attempts` : '' }),
    ]),
  );
  return el('section', { className: 'project' }, [
    el('h2', { text: `${name || '(no project)'} (${tests.length})` }),
    el('ul', { className: 'tests' }, rows),
  ]);
}

function render(root: HTMLElement): void {
  let report: PlaceholderReport;
  try {
    report = readReport();
  } catch {
    root.append(el('p', { className: 'error', text: 'Loupe: could not read report data.' }));
    return;
  }

  document.title = report.run.title;
  const byProject = new Map<string, PlaceholderTest[]>();
  for (const test of report.tests) {
    byProject.set(test.project, [...(byProject.get(test.project) ?? []), test]);
  }
  root.append(
    renderSummary(report),
    ...[...byProject].map(([name, tests]) => renderProject(name, tests)),
  );
}

render(document.getElementById('app') ?? document.body);
