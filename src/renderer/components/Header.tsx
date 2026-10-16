import type { LoupeReport, RunStatus } from '../../schema/v1.js';
import { OUTCOMES } from '../../schema/v1.js';
import { formatDuration } from '../format.js';
import { sidebarOpen, toggleSidebar } from '../layout.js';
import { hrefTo } from '../navigation.js';
import { THEME_CHOICES, setTheme, theme, type ThemeChoice } from '../theme.js';
import { AlertIcon, MoonIcon, OutcomeIcon, SidebarIcon, SunIcon, SystemIcon, outcomeLabel } from './icons.js';

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

export function Header({ report, title }: { report: LoupeReport; title: string }) {
  const { run } = report;
  const meta: Array<[string, string, string?]> = [['Duration', formatDuration(run.durationMs), new Date(run.startedAt).toLocaleString()]];
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
            <li key={outcome} class={run.stats[outcome] === 0 ? 'count zero' : 'count'} title={outcomeLabel(outcome)}>
              <OutcomeIcon outcome={outcome} />
              <span class="count-value">{run.stats[outcome]}</span>
            </li>
          ))}
        </ul>
        <dl class="run-meta">
          {meta.map(([label, value, tooltip]) => (
            <div key={label} title={tooltip}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <ThemeSwitch />
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
