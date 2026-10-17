import type { ComponentChildren } from 'preact';
import type { Outcome } from '../../schema/v1.js';

/** Inline SVG icons (no icon font or external file: the report is one HTML file). */

interface IconProps {
  class?: string;
}

function Svg({ children, class: className }: IconProps & { children: ComponentChildren }) {
  return (
    <svg class={`icon ${className ?? ''}`} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

const OUTCOME_LABELS: Record<Outcome, string> = {
  passed: 'Passed',
  failed: 'Failed',
  flaky: 'Flaky',
  skipped: 'Skipped',
};

export function outcomeLabel(outcome: Outcome): string {
  return OUTCOME_LABELS[outcome];
}

/**
 * Status icon of a test; the shape differs per status, not only the color.
 * `labelled`: the status name is shown next to it. `decorative`: the
 * surrounding text already names the status, so the icon is hidden from
 * assistive technologies.
 */
export function OutcomeIcon({ outcome, labelled = false, decorative = false }: { outcome: Outcome; labelled?: boolean; decorative?: boolean }) {
  const shape = {
    passed: <path d="M4.5 8.2l2.3 2.3 4.7-4.9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />,
    failed: <path d="M5.5 5.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />,
    flaky: (
      <path
        d="M10.9 5.6A3.6 3.6 0 0 0 4.6 7M5.1 10.4A3.6 3.6 0 0 0 11.4 9M10.9 3.6v2h-2M5.1 12.4v-2h2"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    ),
    skipped: <path d="M5 8h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />,
  }[outcome];
  return (
    <span
      class={`outcome-icon outcome-${outcome}`}
      title={labelled || decorative ? undefined : OUTCOME_LABELS[outcome]}
      aria-hidden={decorative ? 'true' : undefined}
    >
      <Svg>
        <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.4" />
        {shape}
      </Svg>
      {!decorative && <span class={labelled ? 'outcome-text' : 'visually-hidden'}>{OUTCOME_LABELS[outcome]}</span>}
    </span>
  );
}

export function ChevronIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
    </Svg>
  );
}

export function SidebarIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3" />
      <path d="M6 2.5v11" stroke="currentColor" stroke-width="1.3" />
    </Svg>
  );
}

export function SystemIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1.5" y="2.5" width="13" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3" />
      <path d="M5.5 14h5M8 11.5V14" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
    </Svg>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.3" />
      <path
        d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3 3l1.1 1.1M11.9 11.9L13 13M3 13l1.1-1.1M11.9 4.1L13 3"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linecap="round"
      />
    </Svg>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5a5.8 5.8 0 1 0 7.1 7.1z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
    </Svg>
  );
}

export function DashboardIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2 2.5h5v5H2zM9 2.5h5v3H9zM9 7.5h5v6H9zM2 9.5h5v4H2z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
    </Svg>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 1.8l6.5 11.4H1.5z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
      <path d="M8 6.2v3.3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      <circle cx="8" cy="11.4" r=".9" fill="currentColor" />
    </Svg>
  );
}

export function ErrorsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.3" />
      <path d="M8 4.6v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      <circle cx="8" cy="11.1" r=".9" fill="currentColor" />
    </Svg>
  );
}

export function HealthIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M1.5 8.5h3l1.5-4 2.5 7 1.8-4.5 1 1.5h3.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
    </Svg>
  );
}

export function TestsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 4h8M6 8h8M6 12h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
      <circle cx="2.8" cy="4" r="1" fill="currentColor" />
      <circle cx="2.8" cy="8" r="1" fill="currentColor" />
      <circle cx="2.8" cy="12" r="1" fill="currentColor" />
    </Svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.4" />
      <path d="M10.4 10.4L14 14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
    </Svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 4.5l7 7m0-7l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </Svg>
  );
}

/** Sort direction of a column: up for ascending, down for descending, both when the column is not sorted. */
export function SortIcon({ direction, ...props }: IconProps & { direction: 'asc' | 'desc' | null }) {
  return (
    <Svg {...props}>
      {direction !== 'desc' && <path d="M5 6.5L8 3.5l3 3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />}
      {direction !== 'asc' && <path d="M5 9.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />}
    </Svg>
  );
}
