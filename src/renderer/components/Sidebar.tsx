import type { ComponentChildren } from 'preact';
import type { LoupeReport } from '../../schema/v1.js';
import { plural } from '../format.js';
import { hrefTo } from '../navigation.js';
import type { Route } from '../router.js';
import type { GroupNode } from '../tree.js';
import { AlertIcon, DashboardIcon, ErrorsIcon, HealthIcon } from './icons.js';
import { Tree } from './Tree.js';

type ViewPage = 'dashboard' | 'errors' | 'health';

function NavLink({ page, route, children, class: className }: { page: ViewPage; route: Route; children: ComponentChildren; class?: string | undefined }) {
  return (
    <li>
      <a class={`nav-link ${className ?? ''}`} href={hrefTo({ page })} aria-current={route.page === page ? 'page' : undefined}>
        {children}
      </a>
    </li>
  );
}

export function Sidebar({ report, tree, route, open }: { report: LoupeReport; tree: GroupNode[]; route: Route; open: boolean }) {
  const runErrors = report.run.errors.length;
  return (
    // Hidden rather than unmounted, so expansion state and scroll survive a collapse.
    <nav id="sidebar" class="sidebar" aria-label="Report" hidden={!open}>
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
      </ul>
      <Tree roots={tree} route={route} />
    </nav>
  );
}
