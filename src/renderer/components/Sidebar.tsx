import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { LoupeReport } from '../../schema/v1.js';
import { filters, setFilters } from '../filters/store.js';
import { activeFilterCount, clearFilters } from '../filters/url.js';
import { plural } from '../format.js';
import { sidebarOpen } from '../layout.js';
import { hrefTo, markSidebarActivation } from '../navigation.js';
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

const VIEW_PAGES: readonly ViewPage[] = ['dashboard', 'errors', 'health', 'tests'];

function isViewPage(page: Route['page']): page is ViewPage {
  return (VIEW_PAGES as readonly string[]).includes(page);
}

/** Up / Down, Home / End: the index of the view link to focus, or null for a key the group leaves alone. */
function viewLinkMove(key: string, index: number): number | null {
  const last = VIEW_PAGES.length - 1;
  const moves: Record<string, number> = { ArrowDown: Math.min(index + 1, last), ArrowUp: Math.max(index - 1, 0), Home: 0, End: last };
  return moves[key] ?? null;
}

/**
 * The four view links: real links in a list, with the current view's marked
 * `aria-current="page"`, and one tab stop for the group, like the tree. Up /
 * Down and Home / End move between them; Enter or Space opens one, and
 * focus stays on it (viewChange.ts). The tab stop is the link last focused,
 * else the current view's, else Overview; a page change resets it to the
 * current view.
 */
function ViewLinks({ route, runErrors }: { route: Route; runErrors: number }) {
  const list = useRef<HTMLUListElement>(null);
  const [focused, setFocused] = useState<ViewPage | null>(null);
  const current = isViewPage(route.page) ? route.page : null;
  useLayoutEffect(() => setFocused(null), [route.page]);
  const stop = focused ?? current ?? 'dashboard';
  const links = (): HTMLAnchorElement[] => [...(list.current?.querySelectorAll<HTMLAnchorElement>('.nav-link') ?? [])];

  const link = (page: ViewPage, children: ComponentChildren, className?: string) => (
    <li>
      <a
        class={`nav-link ${className ?? ''}`}
        href={hrefTo({ page })}
        aria-current={page === current ? 'page' : undefined}
        tabIndex={page === stop ? 0 : -1}
        onFocus={() => setFocused(page)}
      >
        {children}
      </a>
    </li>
  );

  return (
    <ul
      class="nav-fixed"
      ref={list}
      onKeyDown={(event) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const index = links().indexOf(event.target as HTMLAnchorElement);
        if (index === -1) return;
        if (event.key === ' ') {
          // Links open with Enter; Space too, as in the tree.
          event.preventDefault();
          links()[index]?.click();
          return;
        }
        const target = viewLinkMove(event.key, index);
        if (target === null) return;
        event.preventDefault();
        links()[target]?.focus();
      }}
    >
      {link(
        'dashboard',
        <>
          <DashboardIcon />
          <span>Overview</span>
        </>,
      )}
      {link(
        'errors',
        <>
          <ErrorsIcon />
          <span>Errors</span>
          {runErrors > 0 && (
            <span class="nav-marker" title={plural(runErrors, 'run error')}>
              <AlertIcon />
              <span class="badge badge-failed">{runErrors}</span>
              <span class="visually-hidden">, {plural(runErrors, 'run error')}</span>
            </span>
          )}
        </>,
        runErrors > 0 ? 'nav-has-run-errors' : undefined,
      )}
      {link(
        'health',
        <>
          <HealthIcon />
          <span>Suite health</span>
        </>,
      )}
      {link(
        'tests',
        <>
          <TestsIcon />
          <span>Tests</span>
        </>,
      )}
    </ul>
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
    // A page change started here keeps focus in the sidebar (viewChange.ts): a link activated (click, or Enter / Space,
    // which click), or a test row of the tree opened with Enter or Space (the tree navigates without a click). A click
    // with a modifier opens elsewhere: not marked.
    <nav
      id="sidebar"
      class="sidebar"
      aria-label="Report"
      hidden={!open}
      onClickCapture={(event) => {
        const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
        if (link && event.button === 0 && !(event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)) markSidebarActivation(link.getAttribute('href') ?? '');
      }}
      onKeyDownCapture={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const row = event.target instanceof Element ? event.target.closest('[role="treeitem"]') : null;
        const link = row?.querySelector(':scope > a.row-content');
        if (link) markSidebarActivation(link.getAttribute('href') ?? '');
      }}
    >
      <div class="sidebar-search" role="search">
        <SearchField />
        <FilterIndicator matched={matched} route={route} />
      </div>
      {/* Everything below the search scrolls; the search does not, so it never covers a focused row. */}
      <div class="sidebar-scroll">
        <ViewLinks route={route} runErrors={runErrors} />
        <Tree
          roots={tree}
          route={route}
          prefix={prefix}
          expandAll={filtered && matched <= AUTO_EXPAND_MAX}
          emptyMessage={report.tests.length === 0 ? 'No tests in this run.' : 'No tests match the filters.'}
        />
      </div>
    </nav>
  );
}
