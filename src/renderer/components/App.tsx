import { Fragment } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { RendererSettings } from '../../core/inject.js';
import type { LoupeReport, TestCase } from '../../schema/v1.js';
import { announce, announcement } from '../announce.js';
import { closeNarrowSidebar, closeNarrowSidebarOnEscape, isNarrow, overlayOpen, pageScrolls, sidebarOpen } from '../layout.js';
import { currentLocation, navigate, takeNavigationOrigin } from '../navigation.js';
import type { Route } from '../router.js';
import { errorGroups, rankGroups } from '../dashboard.js';
import { filterTests } from '../filters/match.js';
import { buildSortRanks, sortTests } from '../filters/sort.js';
import { context, filters } from '../filters/store.js';
import { DEFAULT_SORT, serializeFilters } from '../filters/url.js';
import { commonDirectoryPrefix } from '../paths.js';
import { forwardScrollKeys } from '../forwardScrollKeys.js';
import { useShortcuts } from '../shortcuts.js';
import { ErrorsPage } from '../pages/ErrorsPage.js';
import { GroupPage } from '../pages/GroupPage.js';
import { HealthPage } from '../pages/HealthPage.js';
import { NotFoundPage } from '../pages/NotFoundPage.js';
import { OverviewPage } from '../pages/OverviewPage.js';
import { TestPage } from '../pages/TestPage.js';
import { TestsPage } from '../pages/TestsPage.js';
import { buildTree, testKey } from '../tree.js';
import { announcesPage, focusesHeading, pageKey, pageName, pageTitle, type ChangeContext } from '../viewChange.js';
import { CopyFallbackDialog } from './Dialog.js';
import { Footer } from './Footer.js';
import { Header } from './Header.js';
import { Sidebar, VIEW_SHORTCUTS } from './Sidebar.js';

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
  const previousRoute = useRef<Route | null>(null);

  // A view by its key, from anywhere: a shortcut, so focus moves to the new page's heading (viewChange.ts).
  useShortcuts({
    [VIEW_SHORTCUTS.dashboard]: () => navigate({ page: 'dashboard' }),
    [VIEW_SHORTCUTS.errors]: () => navigate({ page: 'errors' }),
    [VIEW_SHORTCUTS.health]: () => navigate({ page: 'health' }),
    [VIEW_SHORTCUTS.tests]: () => navigate({ page: 'tests' }),
  });

  // The content scrolls in <main>: scroll keys reach it even when nothing has focus (after load, after a click on text).
  // On short screens the page itself scrolls, and the browser handles the keys.
  useEffect(() => forwardScrollKeys(() => (pageScrolls() ? null : main.current)), []);

  // Escape closes the narrow sidebar, after anything inside it that handles Escape itself.
  useEffect(() => {
    document.addEventListener('keydown', closeNarrowSidebarOnEscape);
    return () => document.removeEventListener('keydown', closeNarrowSidebarOnEscape);
  }, []);

  // A new page starts at the top, like a page load.
  const routeKey = pageKey(route);
  const opensSection = (route.page === 'errors' && route.category !== undefined) || (route.page === 'dashboard' && route.section !== undefined);
  // On narrow screens the sidebar is an overlay: close it once a page is chosen. A layout effect, so the content stops
  // being inert before the pages' effects run: a page opened on a section focuses it there. Focus inside the sidebar
  // moves to the page's heading in the effect below.
  useLayoutEffect(() => {
    closeNarrowSidebar();
  }, [routeKey]);
  useEffect(() => {
    // Except a link to a section (a category, the run details): the page scrolls to it.
    if (!opensSection) {
      main.current?.scrollTo(0, 0);
      // On short screens the page scrolls, not <main>.
      if (pageScrolls()) window.scrollTo(0, 0);
    }
    document.title = pageTitle(route, report.tests, settings.title);
    // Another page, not the first load (viewChange.ts): started in the visible sidebar, focus stays there and the
    // page name is announced; otherwise focus moves to the page's heading, which is announced, and the keyboard
    // continues from there. This effect runs after the page's own: a page opened on a section has already focused it.
    const context: ChangeContext = {
      origin: takeNavigationOrigin(),
      narrow: isNarrow(),
      sectionFocused: opensSection && main.current?.contains(document.activeElement) === true,
    };
    const previous = previousRoute.current;
    previousRoute.current = route;
    if (announcesPage(previous, route, context)) announce(pageName(route, report.tests));
    if (!focusesHeading(previous, route, context)) return;
    const heading = main.current?.querySelector<HTMLElement>('h1');
    if (!heading) return;
    heading.tabIndex = -1;
    // On short screens the header can fill the viewport: let the heading scroll into view.
    heading.focus({ preventScroll: !pageScrolls() });
  }, [routeKey]);

  // "Skip to test list": the sidebar may first have to open, so focus moves once it is rendered.
  const [treeSkip, setTreeSkip] = useState(0);
  useEffect(() => {
    if (treeSkip === 0) return;
    // The tree's single tab stop (the current or last focused row); the "Tests" heading when no row matches.
    const target = document.querySelector<HTMLElement>('#sidebar [role="treeitem"][tabindex="0"]') ?? document.getElementById('tree-heading');
    target?.focus();
  }, [treeSkip]);

  let page;
  switch (route.page) {
    case 'dashboard':
      page = <OverviewPage report={report} groups={groups} matched={sorted} section={route.section} />;
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
      <button
        type="button"
        class="button skip-link"
        onClick={() => {
          // With the narrow sidebar open, the content is inert: close the sidebar first.
          closeNarrowSidebar();
          // <main> can be taller than the viewport: its top in view, not its middle (the page scrolls on short screens).
          main.current?.focus({ preventScroll: true });
          if (pageScrolls()) main.current?.scrollIntoView({ block: 'start' });
        }}
      >
        Skip to content
      </button>
      {/* Second: back to the tree from the top, opening the sidebar when it is closed (the narrow overlay, or collapsed). */}
      <button
        type="button"
        class="button skip-link"
        onClick={() => {
          sidebarOpen.value = true;
          setTreeSkip((count) => count + 1);
        }}
      >
        Skip to test list
      </button>
      <Header report={report} title={settings.title} />
      <div class="layout">
        <Sidebar report={report} tree={tree} prefix={prefix} matched={matched.length} route={route} open={sidebarOpen.value} />
        {/* Behind the narrow sidebar: a click closes it. Pointer only, so not focusable and hidden from assistive technology (Escape is the keyboard's way). */}
        {overlayOpen.value && <div class="sidebar-backdrop" aria-hidden="true" onClick={closeNarrowSidebar} />}
        {/* Inert behind the narrow sidebar, so focus cannot wander behind it; the header stays reachable for the toggle. */}
        <main class="main" ref={main} tabIndex={-1} inert={overlayOpen.value}>
          {/* Keyed by page: another test or group gets a new heading, so moving focus to it is announced. */}
          <Fragment key={routeKey}>{page}</Fragment>
          <Footer version={report.generator.version} />
        </main>
      </div>
      <CopyFallbackDialog />
      {/* Always present, so changes are announced. */}
      <p class="visually-hidden" role="status" aria-live="polite">
        {announcement.value}
      </p>
    </div>
  );
}
