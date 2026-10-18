import { useState } from 'preact/hooks';
import type { Attachment, LoupeError, Output, Step } from '../../schema/v1.js';
import type { ErrorGroup } from '../dashboard.js';
import { NO_CATEGORY } from '../dashboard.js';
import { highlightMessage, highlightSnippet } from '../detail/highlight.js';
import { fileHref } from '../detail/media.js';
import { failingPath, stepTree, type StepMode, type StepNode } from '../detail/steps.js';
import { formatDuration, plural } from '../format.js';
import { CategoryBadge } from './CategoryBadge.js';
import { Highlighted } from './Highlighted.js';
import { ChevronIcon, OutcomeIcon } from './icons.js';
import { groupHref } from './widgets.js';

/** Sections of the test detail for one attempt: errors, steps, attachments (see Media.tsx), output. */

function locationText(location: { file: string; line: number; column?: number } | null): string | null {
  if (!location) return null;
  return location.column === undefined ? `${location.file}:${location.line}` : `${location.file}:${location.line}:${location.column}`;
}

export function ErrorCard({ error, group, color }: { error: LoupeError; group: ErrorGroup | undefined; color: string | undefined }) {
  const location = locationText(error.location);
  const category = error.category ?? NO_CATEGORY;
  return (
    <article class="error-card">
      <div class="error-head">
        <CategoryBadge name={category} color={color} />
        {location && <code class="error-location">{location}</code>}
        {group && (
          <a class="error-group-link" href={groupHref(group.signature)} title="Every test failing with this error">
            View error group <span class="muted">({plural(group.tests.length, 'test')})</span>
          </a>
        )}
      </div>
      <pre class="message error-message">
        <Highlighted lines={highlightMessage(error.message)} />
      </pre>
      {error.snippet && (
        <pre class="code-snippet">
          <Highlighted lines={highlightSnippet(error.snippet)} />
        </pre>
      )}
      {error.stack && error.stack !== error.message && (
        <details class="stack-details">
          <summary>
            <ChevronIcon class="chevron" />
            Show stack
          </summary>
          <pre class="stack">{error.stack}</pre>
        </details>
      )}
    </article>
  );
}

/** A step error is shown on the step it started from: not on its ancestors, which carry the same error. */
function ownsError(step: Step): boolean {
  return step.error !== null && !step.steps.some((child) => child.error !== null);
}

function StepRow({ node, mode, expanded, toggle }: { node: StepNode; mode: StepMode; expanded: ReadonlySet<string>; toggle: (key: string) => void }) {
  const { step, children } = node;
  const open = expanded.has(node.key);
  const location = locationText(step.location ? { file: step.location.file, line: step.location.line } : null);
  return (
    <li class={`step${node.onFailingPath ? ' step-failing-path' : ''}${node.failing ? ' step-failing' : ''}`} data-category={step.category}>
      <div class="step-row">
        {children.length > 0 ? (
          <button type="button" class="step-toggle" aria-expanded={open} onClick={() => toggle(node.key)}>
            <ChevronIcon class="chevron" />
            <span class="visually-hidden">
              {open ? 'Collapse' : 'Expand'} {step.title}
            </span>
          </button>
        ) : (
          <span class="step-toggle-space" />
        )}
        {step.error ? <OutcomeIcon outcome="failed" /> : <span class="step-icon-space" />}
        <span class="step-text">
          <span class="step-title">{step.title}</span>
          {step.subtitle && <span class="step-subtitle"> {step.subtitle}</span>}
          {mode === 'all' && <span class="step-category">{step.category}</span>}
          {node.failing && <span class="visually-hidden"> (failing step)</span>}
        </span>
        {location && <code class="step-location">{location}</code>}
        <span class="step-duration">{formatDuration(step.durationMs)}</span>
      </div>
      {step.error && ownsError(step) && (
        <pre class="message step-error">
          <Highlighted lines={highlightMessage(step.error.message)} />
        </pre>
      )}
      {open && children.length > 0 && <StepList nodes={children} mode={mode} expanded={expanded} toggle={toggle} />}
    </li>
  );
}

function StepList({ nodes, mode, expanded, toggle }: { nodes: readonly StepNode[]; mode: StepMode; expanded: ReadonlySet<string>; toggle: (key: string) => void }) {
  return (
    <ul class="step-list">
      {nodes.map((node) => (
        <StepRow key={node.key} node={node} mode={mode} expanded={expanded} toggle={toggle} />
      ))}
    </ul>
  );
}

/**
 * The steps of an attempt. The failing path starts expanded; keyed by
 * attempt, so another attempt starts again from its own failing path.
 */
export function StepTree({ steps, mode }: { steps: readonly Step[]; mode: StepMode }) {
  const nodes = stepTree(steps, mode);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(failingPath(steps)));
  const toggle = (key: string): void =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  if (nodes.length === 0) return <p class="muted">No {mode === 'default' ? 'test.step or failing step' : 'step'} in this attempt.</p>;
  return <StepList nodes={nodes} mode={mode} expanded={expanded} toggle={toggle} />;
}

const encoder = new TextEncoder();

export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** An attachment as a link to its file, or its text body inline and collapsed. */
export function AttachmentItem({ attachment }: { attachment: Attachment }) {
  const meta = (size: string | null) => (
    <span class="attachment-meta">
      {attachment.contentType}
      {size && ` · ${size}`}
    </span>
  );
  if (attachment.body !== null) {
    return (
      <details class="attachment-body">
        <summary>
          <ChevronIcon class="chevron" />
          <span class="attachment-name">{attachment.name}</span>
          {meta(formatBytes(encoder.encode(attachment.body).length))}
        </summary>
        <pre>{attachment.body}</pre>
      </details>
    );
  }
  return (
    <div class="attachment-file">
      {attachment.path ? (
        <a class="attachment-name" href={fileHref(attachment.path)}>
          {attachment.name}
        </a>
      ) : (
        <span class="attachment-name">
          {attachment.name} <span class="muted">(file missing)</span>
        </span>
      )}
      {meta(null)}
    </div>
  );
}

/** stdout or stderr, collapsed, with a notice when it was truncated. */
export function OutputBlock({ name, output }: { name: string; output: Output }) {
  if (output.text === '' && !output.truncated) return null;
  const lines = output.text.split('\n').filter((line, index, all) => line !== '' || index < all.length - 1).length;
  return (
    <details class="output-block">
      <summary>
        <ChevronIcon class="chevron" />
        <span class="output-name">{name}</span>
        <span class="muted">{plural(lines, 'line')}</span>
        {output.truncated && <span class="output-truncated">truncated</span>}
      </summary>
      {output.truncated && <p class="output-notice">Truncated: the report keeps the first 32,768 characters of each attempt.</p>}
      <pre>{output.text}</pre>
    </details>
  );
}
