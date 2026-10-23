import { useMemo, useState } from 'preact/hooks';
import type { LoupeReport, Outcome, RunStatus } from '../../schema/v1.js';
import { OUTCOMES } from '../../schema/v1.js';
import { formatRunStart } from '../datetime.js';
import { filtersHref } from '../filters/store.js';
import { EMPTY_FILTERS } from '../filters/url.js';
import { formatDuration } from '../format.js';
import { sidebarOpen, toggleSidebar } from '../layout.js';
import { hrefTo } from '../navigation.js';
import { scopeReasonLabel } from '../runDetails.js';
import { singleKeyHint, useShortcuts } from '../shortcuts.js';
import { THEME_CHOICES, setTheme, theme, type ThemeChoice } from '../theme.js';
import { ShortcutsDialog } from './Dialog.js';
import { AlertIcon, KeyboardIcon, MoonIcon, OutcomeIcon, SidebarIcon, SunIcon, SystemIcon, outcomeLabel } from './icons.js';

const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  passed: 'Passed',
  failed: 'Failed',
  timedout: 'Timed out',
  interrupted: 'Interrupted',
};

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
      <button
        type="button"
        class="icon-button"
        title={singleKeyHint('?') ? 'Keyboard shortcuts (?)' : 'Keyboard shortcuts'}
        aria-keyshortcuts={singleKeyHint('?')}
        onClick={() => setOpen(true)}
      >
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

/**
 * Two columns: the run on the left, which wraps, and the controls on the
 * right, always top-right. The left column has three groups that wrap as
 * units, in order: identity and verdict, status counts, start and
 * environment.
 */
export function Header({ report, title }: { report: LoupeReport; title: string }) {
  const { run } = report;

  // One banner landmark for the header and the partial run note, which applies to every view.
  return (
    <header class="masthead">
      <div class="header">
        <div class="header-main">
          <div class="header-identity">
            <div class="header-name">
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
                <a class="title" href={hrefTo({ page: 'dashboard' })} title={title}>
                  {title}
                </a>
              </div>
            </div>
            <span class={`run-status run-${run.status}`}>
              <OutcomeIcon outcome={run.status === 'passed' ? 'passed' : 'failed'} decorative />
              {RUN_STATUS_LABELS[run.status] ?? run.status}
            </span>
          </div>
          <ul class="counts" aria-label="Test counts">
            {OUTCOMES.map((outcome) => (
              <CountLink key={outcome} outcome={outcome} count={run.stats[outcome]} />
            ))}
          </ul>
          <dl class="run-meta">
            <RunTime startedAt={run.startedAt} durationMs={run.durationMs} />
            {run.environment.name && (
              <div>
                <dt>Environment</dt>
                <dd>{run.environment.name}</dd>
              </div>
            )}
          </dl>
        </div>
        <div class="header-tools">
          <ShortcutsButton />
          <ThemeSwitch />
        </div>
      </div>
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
    </header>
  );
}
