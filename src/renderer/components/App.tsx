import { useEffect, useMemo, useRef } from 'preact/hooks';
import type { RendererSettings } from '../../core/inject.js';
import type { LoupeReport, TestCase } from '../../schema/v1.js';
import { isNarrow, sidebarOpen } from '../layout.js';
import { currentLocation } from '../navigation.js';
import { errorGroups } from '../dashboard.js';
import { filterTests } from '../filters/match.js';
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
  const groups = useMemo(() => errorGroups(report), [report]);
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
      page = <OverviewPage report={report} groups={groups} />;
      break;
    case 'errors':
      page = <ErrorsPage report={report} groups={groups} category={route.category} />;
      break;
    case 'health':
      page = <HealthPage report={report} />;
      break;
    case 'tests':
      page = <TestsPage report={report} state={state} matched={matched} />;
      break;
    case 'test':
      page = <TestPage test={testsByKey.get(testKey(route.id, route.repeatEachIndex))} />;
      break;
    case 'group':
      page = <GroupPage report={report} group={groups.find((group) => group.signature === route.signature)} />;
      break;
    case 'not-found':
      page = <NotFoundPage />;
      break;
  }

  return (
    <div class={`app ${sidebarOpen.value ? 'sidebar-open' : 'sidebar-closed'}`}>
      <Header report={report} title={settings.title} />
      <div class="layout">
        <Sidebar report={report} tree={tree} prefix={prefix} matched={matched.length} route={route} open={sidebarOpen.value} />
        <main class="main" ref={main} tabIndex={-1}>
          {page}
          <Footer version={report.generator.version} />
        </main>
      </div>
    </div>
  );
}
