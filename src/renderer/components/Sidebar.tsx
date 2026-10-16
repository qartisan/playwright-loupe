import type { LoupeReport } from '../../schema/v1.js';
import { hrefTo } from '../navigation.js';
import type { Route } from '../router.js';
import type { GroupNode } from '../tree.js';
import { AlertIcon, DashboardIcon } from './icons.js';
import { Tree } from './Tree.js';

export function Sidebar({ report, tree, route, open }: { report: LoupeReport; tree: GroupNode[]; route: Route; open: boolean }) {
  const runErrors = report.run.errors.length;
  return (
    // Hidden rather than unmounted, so expansion state and scroll survive a collapse.
    <nav id="sidebar" class="sidebar" aria-label="Report" hidden={!open}>
      <ul class="nav-fixed">
        <li>
          <a class="nav-link" href={hrefTo({ page: 'dashboard' })} aria-current={route.page === 'dashboard' ? 'page' : undefined}>
            <DashboardIcon />
            <span>Dashboard</span>
          </a>
        </li>
        {runErrors > 0 && (
          <li>
            <a
              class="nav-link nav-run-errors"
              href={hrefTo({ page: 'run-errors' })}
              aria-current={route.page === 'run-errors' ? 'page' : undefined}
            >
              <AlertIcon />
              <span>Run errors</span>
              <span class="badge badge-failed" aria-label={`${runErrors} run errors`}>
                {runErrors}
              </span>
            </a>
          </li>
        )}
      </ul>
      <Tree roots={tree} route={route} />
    </nav>
  );
}
