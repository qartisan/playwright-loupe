import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { LoupeReport } from '../../schema/v1.js';
import { filters, setFilters } from '../filters/store.js';
import { activeFilterCount, clearFilters } from '../filters/url.js';
import { plural } from '../format.js';
import { sidebarOpen } from '../layout.js';
import { hrefTo } from '../navigation.js';
import type { Route } from '../router.js';
import { shortcutAllowed } from '../shortcuts.js';
import type { GroupNode } from '../tree.js';
import { AlertIcon, DashboardIcon, ErrorsIcon, HealthIcon, SearchIcon, TestsIcon } from './icons.js';
import { Tree } from './Tree.js';

type ViewPage = 'dashboard' | 'errors' | 'health' | 'tests';

/** Typing in the search field updates the URL after this pause, replacing the history entry. */
const SEARCH_DEBOUNCE_MS = 200;

/** A filtered tree with at most this many tests opens fully, so the matches show. */
const AUTO_EXPAND_MAX = 300;

function NavLink({ page, route, children, class: className }: { page: ViewPage; route: Route; children: ComponentChildren; class?: string | undefined }) {
  return (
    <li>
      <a class={`nav-link ${className ?? ''}`} href={hrefTo({ page })} aria-current={route.page === page ? 'page' : undefined}>
        {children}
      </a>
    </li>
  );
}

/**
 * Search bound to the `q` filter. Typing writes the URL after a pause and
 * replaces the history entry, so it does not fill the history. `/` focuses
 * the field from anywhere but a text field; Escape clears it.
 */
function SearchField() {
  const q = filters.value.q;
  const [value, setValue] = useState(q);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Follows the URL when it changes elsewhere (Back, a link, "Clear"), not while typing.
  useLayoutEffect(() => {
    if (q.trim() !== value.trim()) {
      clearTimeout(timer.current);
      setValue(q);
    }
  }, [q]);

  // A layout effect: listening as soon as the page shows, not after the first paint.
  useLayoutEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== '/' || !shortcutAllowed(event)) return;
      event.preventDefault();
      if (sidebarOpen.value) {
        input.current?.focus();
        return;
      }
      sidebarOpen.value = true;
      // The sidebar is only now shown: focus once it is rendered.
      setTimeout(() => input.current?.focus(), 0);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      clearTimeout(timer.current);
    };
  }, []);

  const commit = (text: string): void => setFilters({ ...filters.value, q: text }, 'replace');

  return (
    <div class="search-field">
      <label for="sidebar-search" class="visually-hidden">
        Search tests
      </label>
      <SearchIcon />
      <input
        ref={input}
        id="sidebar-search"
        type="search"
        placeholder="Search tests"
        autoComplete="off"
        spellcheck={false}
        aria-keyshortcuts="/"
        value={value}
        onInput={(event) => {
          const text = event.currentTarget.value;
          setValue(text);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => commit(text), SEARCH_DEBOUNCE_MS);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || value === '') return;
          event.preventDefault();
          clearTimeout(timer.current);
          setValue('');
          commit('');
        }}
      />
      <kbd class="search-key" aria-hidden="true">
        /
      </kbd>
    </div>
  );
}

/** `3 filters · 12 tests` and Clear, when a filter is active. Announced, except in the Tests view, which announces its own count. */
function FilterIndicator({ matched, route }: { matched: number; route: Route }) {
  const state = filters.value;
  const count = activeFilterCount(state);
  return (
    <div class="filter-indicator" aria-live={route.page === 'tests' ? 'off' : 'polite'}>
      {count > 0 && (
        <p>
          <span>{plural(count, 'filter')}</span>
          {' · '}
          <a href={hrefTo({ page: 'tests' })}>{plural(matched, 'test')}</a>
          <button type="button" class="text-button" onClick={() => setFilters(clearFilters(state))}>
            Clear
          </button>
        </p>
      )}
    </div>
  );
}

export function Sidebar({
  report,
  tree,
  prefix,
  matched,
  route,
  open,
}: {
  report: LoupeReport;
  tree: GroupNode[];
  prefix: string;
  matched: number;
  route: Route;
  open: boolean;
}) {
  const runErrors = report.run.errors.length;
  const filtered = activeFilterCount(filters.value) > 0;
  return (
    // Hidden rather than unmounted, so expansion state and scroll survive a collapse.
    <nav id="sidebar" class="sidebar" aria-label="Report" hidden={!open}>
      <div class="sidebar-search" role="search">
        <SearchField />
        <FilterIndicator matched={matched} route={route} />
      </div>
      <ul class="nav-fixed">
        <NavLink page="dashboard" route={route}>
          <DashboardIcon />
          <span>Overview</span>
        </NavLink>
        <NavLink page="errors" route={route} class={runErrors > 0 ? 'nav-has-run-errors' : undefined}>
          <ErrorsIcon />
          <span>Errors</span>
          {runErrors > 0 && (
            <span class="nav-marker" title={plural(runErrors, 'run error')}>
              <AlertIcon />
              <span class="badge badge-failed">{runErrors}</span>
              <span class="visually-hidden">, {plural(runErrors, 'run error')}</span>
            </span>
          )}
        </NavLink>
        <NavLink page="health" route={route}>
          <HealthIcon />
          <span>Suite health</span>
        </NavLink>
        <NavLink page="tests" route={route}>
          <TestsIcon />
          <span>Tests</span>
        </NavLink>
      </ul>
      <Tree
        roots={tree}
        route={route}
        prefix={prefix}
        expandAll={filtered && matched <= AUTO_EXPAND_MAX}
        emptyMessage={report.tests.length === 0 ? 'No tests in this run.' : 'No tests match the filters.'}
      />
    </nav>
  );
}
