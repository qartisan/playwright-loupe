import { useEffect, useMemo, useRef } from 'preact/hooks';
import type { RendererSettings } from '../../core/inject.js';
import type { LoupeReport, TestCase } from '../../schema/v1.js';
import { announcement } from '../clipboard.js';
import { isNarrow, sidebarOpen } from '../layout.js';
import { currentLocation } from '../navigation.js';
import { errorGroups, rankGroups } from '../dashboard.js';
import { filterTests } from '../filters/match.js';
import { buildSortRanks, sortTests } from '../filters/sort.js';
import { context, filters } from '../filters/store.js';
import { DEFAULT_SORT, serializeFilters } from '../filters/url.js';
import { commonDirectoryPrefix } from '../paths.js';
import { ErrorsPage } from '../pages/ErrorsPage.js';
import { GroupPage } from '../pages/GroupPage.js';
import { HealthPage } from '../pages/HealthPage.js';
import { NotFoundPage } from '../pages/NotFoundPage.js';
import { OverviewPage } from '../pages/OverviewPage.js';
import { TestPage } from '../pages/TestPage.js';
import { TestsPage } from '../pages/TestsPage.js';
import { buildTree, testKey } from '../tree.js';
import { CopyFallbackDialog } from './Dialog.js';
import { Footer } from './Footer.js';
import { Header } from './Header.js';
import { Sidebar } from './Sidebar.js';

export function App({ report, settings }: { report: LoupeReport; settings: RendererSettings }) {
  // One filter state for the sidebar and the Tests view; the sort only matters to the Tests view.
  const state = filters.value;
  const filterKey = serializeFilters({ ...state, sort: DEFAULT_SORT });
  const matched = useMemo(() => filterTests(report.tests, state, context.value), [report, filterKey]);
  // From every file of the run, so folders do not change with the filters.
  const prefix = useMemo(() => commonDirectoryPrefix(report.tests.map((test) => test.file)), [report]);
  const tree = useMemo(() => buildTree({ projects: report.projects, tests: matched }, { prefix }), [report, matched, prefix]);
  const testsByKey = useMemo(
    () => new Map<string, TestCase>(report.tests.map((test) => [testKey(test.id, test.repeatEachIndex), test])),
    [report],
  );
  // The Tests view's order, every row: the Tests view and the test detail's previous / next.
  const ranks = useMemo(() => buildSortRanks(report.tests, report.projects.map((project) => project.name)), [report]);
  const sorted = useMemo(() => sortTests(matched, state.sort, ranks), [matched, ranks, state.sort.column, state.sort.direction]);
  const groups = useMemo(() => errorGroups(report), [report]);
  const ranked = useMemo(() => rankGroups(groups), [groups]);
  const groupsBySignature = useMemo(() => new Map(groups.map((group) => [group.signature, group])), [groups]);
  const { route } = currentLocation.value;
  const main = useRef<HTMLElement>(null);

  // A new page starts at the top, like a page load.
  const routeKey = JSON.stringify(route);
  useEffect(() => {
    // Except a link to a category: the errors view scrolls to it.
    if (!(route.page === 'errors' && route.category !== undefined)) main.current?.scrollTo(0, 0);
    // On narrow screens the sidebar is an overlay: close it once a page is chosen.
    if (isNarrow()) sidebarOpen.value = false;
  }, [routeKey]);

  let page;
  switch (route.page) {
    case 'dashboard':
      page = <OverviewPage report={report} groups={groups} matched={sorted} />;
      break;
    case 'errors':
      page = <ErrorsPage report={report} groups={groups} category={route.category} />;
      break;
    case 'health':
      page = <HealthPage report={report} />;
      break;
    case 'tests':
      page = <TestsPage report={report} state={state} sorted={sorted} />;
      break;
    case 'test':
      page = (
        <TestPage
          report={report}
          test={testsByKey.get(testKey(route.id, route.repeatEachIndex))}
          sequence={sorted}
          groups={groupsBySignature}
          settings={settings}
        />
      );
      break;
    case 'group':
      page = <GroupPage report={report} groups={ranked} group={groupsBySignature.get(route.signature)} />;
      break;
    case 'not-found':
      page = <NotFoundPage />;
      break;
  }

  return (
    <div class={`app ${sidebarOpen.value ? 'sidebar-open' : 'sidebar-closed'}`}>
      {/* The first focusable element, shown on focus. A button, not a link: the hash holds the route, so it moves focus without changing it. */}
      <button type="button" class="button skip-link" onClick={() => main.current?.focus()}>
        Skip to content
      </button>
      <Header report={report} title={settings.title} />
      <div class="layout">
        <Sidebar report={report} tree={tree} prefix={prefix} matched={matched.length} route={route} open={sidebarOpen.value} />
        <main class="main" ref={main} tabIndex={-1}>
          {page}
          <Footer version={report.generator.version} />
        </main>
      </div>
      <CopyFallbackDialog />
      {/* Always present, so changes are announced; a repeated message differs by a trailing no-break space. */}
      <p class="visually-hidden" role="status" aria-live="polite">
        {announcement.value.text}
        {announcement.value.seq % 2 === 1 ? '\u00a0' : ''}
      </p>
    </div>
  );
}
