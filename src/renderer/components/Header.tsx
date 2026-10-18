import { useMemo, useState } from 'preact/hooks';
import type { LoupeReport, Outcome, RunStatus } from '../../schema/v1.js';
import { OUTCOMES } from '../../schema/v1.js';
import { formatRunStart } from '../datetime.js';
import { filtersHref } from '../filters/store.js';
import { EMPTY_FILTERS } from '../filters/url.js';
import { formatDuration } from '../format.js';
import { sidebarOpen, toggleSidebar } from '../layout.js';
import { hrefTo } from '../navigation.js';
import { useShortcuts } from '../shortcuts.js';
import { THEME_CHOICES, setTheme, theme, type ThemeChoice } from '../theme.js';
import { ShortcutsDialog } from './Dialog.js';
import { AlertIcon, KeyboardIcon, MoonIcon, OutcomeIcon, SidebarIcon, SunIcon, SystemIcon, outcomeLabel } from './icons.js';

const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  passed: 'Passed',
  failed: 'Failed',
  timedout: 'Timed out',
  interrupted: 'Interrupted',
};

/** Reasons a run is partial (docs/schema/v1.md, "Run scope"). Unknown reasons are shown as is. */
const SCOPE_REASON_LABELS: Record<string, string> = {
  env: 'LOUPE_RUN_SCOPE=partial',
  'file-filter': 'file filter',
  grep: 'grep filter',
  'project-filter': 'project filter',
  'last-failed': '--last-failed',
  'only-changed': '--only-changed',
  'test-list': 'test list',
  only: 'test.only',
  shard: 'single shard',
  list: '--list (no test ran)',
};

function scopeReasonLabel(reason: string): string {
  return SCOPE_REASON_LABELS[reason] ?? reason;
}

const THEME_LABELS: Record<ThemeChoice, string> = { system: 'System theme', light: 'Light theme', dark: 'Dark theme' };
const THEME_ICONS = { system: SystemIcon, light: SunIcon, dark: MoonIcon };

function ThemeSwitch() {
  return (
    <div class="theme-switch" role="group" aria-label="Theme">
      {THEME_CHOICES.map((choice) => {
        const Icon = THEME_ICONS[choice];
        return (
          <button
            key={choice}
            type="button"
            class="icon-button"
            aria-pressed={theme.value === choice}
            title={THEME_LABELS[choice]}
            onClick={() => setTheme(choice)}
          >
            <Icon />
            <span class="visually-hidden">{THEME_LABELS[choice]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Opens the keyboard shortcuts dialog; `?` opens it from anywhere. */
function ShortcutsButton() {
  const [open, setOpen] = useState(false);
  useShortcuts({ '?': () => setOpen(true) });
  return (
    <>
      <button type="button" class="icon-button" title="Keyboard shortcuts (?)" aria-keyshortcuts="?" onClick={() => setOpen(true)}>
        <KeyboardIcon />
        <span class="visually-hidden">Keyboard shortcuts</span>
      </button>
      <ShortcutsDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/**
 * The run start in the viewer's time zone, then the duration. Hover or focus
 * shows the full date with seconds, the time zone and the UTC timestamp;
 * Escape hides it (WCAG 1.4.13). Without a valid start, the duration alone.
 */
function RunTime({ startedAt, durationMs }: { startedAt: unknown; durationMs: number }) {
  const start = useMemo(() => formatRunStart(startedAt), [startedAt]);
  const [dismissed, setDismissed] = useState(false);
  return (
    <div class="run-time" onPointerLeave={() => setDismissed(false)}>
      <dt class="visually-hidden">Run</dt>
      <dd>
        {start && (
          <>
            <time
              dateTime={start.utc}
              tabIndex={0}
              aria-describedby="run-time-details"
              onKeyDown={(event) => event.key === 'Escape' && setDismissed(true)}
              onBlur={() => setDismissed(false)}
            >
              {start.label}
            </time>
            {' · '}
          </>
        )}
        {formatDuration(durationMs)}
      </dd>
      {start && (
        <span id="run-time-details" role="tooltip" class={`run-time-details${dismissed ? ' dismissed' : ''}`}>
          <span>{start.full}</span>
          <span>Time zone: {start.timeZone}</span>
          <span>UTC: {start.utc}</span>
        </span>
      )}
    </div>
  );
}

/** A count of the header: a link to those tests in the Tests view, except a zero count. */
function CountLink({ outcome, count }: { outcome: Outcome; count: number }) {
  const label = outcomeLabel(outcome).toLowerCase();
  const content = (
    <>
      <OutcomeIcon outcome={outcome} decorative />
      <span class="count-value">{count}</span>
      <span class="visually-hidden"> {label}</span>
    </>
  );
  if (count === 0) {
    return (
      <li class="count zero" title={outcomeLabel(outcome)}>
        {content}
      </li>
    );
  }
  // Replaces the current filter: "show me all failures".
  const href = filtersHref({ ...EMPTY_FILTERS, facets: { status: [outcome] } }, { page: 'tests' });
  return (
    <li class="count">
      <a class="count-link" href={href} title={`Show the ${count} ${label} ${count === 1 ? 'test' : 'tests'}`}>
        {content}
      </a>
    </li>
  );
}

export function Header({ report, title }: { report: LoupeReport; title: string }) {
  const { run } = report;
  const meta: Array<[string, string, string?]> = [];
  if (run.git.branch) meta.push(['Branch', run.git.branch]);
  if (run.git.commit) meta.push(['Commit', run.git.commit.slice(0, 8), run.git.commit]);
  if (run.environment.name) meta.push(['Environment', run.environment.name]);

  return (
    <>
      <header class="header">
        <button
          type="button"
          class="icon-button"
          aria-controls="sidebar"
          aria-expanded={sidebarOpen.value}
          title={sidebarOpen.value ? 'Hide sidebar' : 'Show sidebar'}
          onClick={toggleSidebar}
        >
          <SidebarIcon />
          <span class="visually-hidden">{sidebarOpen.value ? 'Hide sidebar' : 'Show sidebar'}</span>
        </button>
        <div class="brand">
          <span class="wordmark">Loupe</span>
          <a class="title" href={hrefTo({ page: 'dashboard' })}>
            {title}
          </a>
        </div>
        <span class={`run-status run-${run.status}`}>
          <OutcomeIcon outcome={run.status === 'passed' ? 'passed' : 'failed'} decorative />
          {RUN_STATUS_LABELS[run.status] ?? run.status}
        </span>
        <ul class="counts" aria-label="Test counts">
          {OUTCOMES.map((outcome) => (
            <CountLink key={outcome} outcome={outcome} count={run.stats[outcome]} />
          ))}
        </ul>
        <dl class="run-meta">
          <RunTime startedAt={run.startedAt} durationMs={run.durationMs} />
          {meta.map(([label, value, tooltip]) => (
            <div key={label} title={tooltip}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <div class="header-tools">
          <ShortcutsButton />
          <ThemeSwitch />
        </div>
      </header>
      {run.scope === 'partial' && (
        <div class="banner banner-partial" role="note">
          <AlertIcon />
          <p>
            <strong>Partial run.</strong> Only part of the suite ran, so these results do not cover every test.
            {run.scopeReasons.length > 0 && (
              <>
                {' '}
                Detected from: {run.scopeReasons.map(scopeReasonLabel).join(', ')}.
              </>
            )}
          </p>
        </div>
      )}
    </>
  );
}
