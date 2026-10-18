import { signal } from '@preact/signals';
import { useEffect, useId, useState } from 'preact/hooks';
import type { Attachment, ComparisonRole } from '../../schema/v1.js';
import { MODE_LABELS, comparisonModes, fileHref, pickMode, type ComparisonMode, type ComparisonSet } from '../detail/media.js';
import { MediaImage, MissingMedia } from './Media.js';

/**
 * A screenshot comparison (`toHaveScreenshot` / `toMatchSnapshot`): Diff,
 * Side by side, Slider (actual over expected, a divider to drag) and Overlay
 * (actual over expected, its opacity to set). The same viewer is shown in the
 * test detail and in the lightbox.
 */

/** The mode chosen last, shared by every comparison for the session; in memory only, never in the URL. */
const chosenMode = signal<ComparisonMode | null>(null);

const ROLE_LABELS: Record<ComparisonRole, string> = { expected: 'Expected', actual: 'Actual', diff: 'Diff' };

type Size = readonly [width: number, height: number];

/** Natural sizes by role, loaded once per set of files: undefined while loading, null when the file cannot be loaded. */
function useNaturalSizes(set: ComparisonSet): Partial<Record<ComparisonRole, Size | null>> {
  const [sizes, setSizes] = useState<Partial<Record<ComparisonRole, Size | null>>>({});
  const entries = Object.entries(set.images) as [ComparisonRole, Attachment][];
  const key = entries.map(([role, attachment]) => `${role}:${attachment.path}`).join('\n');
  useEffect(() => {
    let live = true;
    const record = (role: ComparisonRole, size: Size | null): void => {
      if (live) setSizes((current) => ({ ...current, [role]: size }));
    };
    for (const [role, attachment] of entries) {
      if (!attachment.path) {
        record(role, null);
        continue;
      }
      const image = new Image();
      image.onload = () => record(role, [image.naturalWidth, image.naturalHeight]);
      image.onerror = () => record(role, null);
      image.src = fileHref(attachment.path);
    }
    return () => {
      live = false;
    };
  }, [key]);
  return sizes;
}

function sizeText(size: Size | null | undefined): string {
  if (size === undefined) return '…';
  return size === null ? 'not found' : `${size[0]} × ${size[1]}`;
}

/** Actual over expected, top-left aligned, in a box the size of the larger image: each layer is a share of its width. */
function Stack({ set, sizes, mode, onImageClick }: { set: ComparisonSet; sizes: Partial<Record<ComparisonRole, Size | null>>; mode: 'slider' | 'overlay'; onImageClick: (() => void) | undefined }) {
  const [divider, setDivider] = useState(50);
  const [opacity, setOpacity] = useState(50);
  const hintId = useId();
  const { expected, actual } = set.images as Required<ComparisonSet['images']>;
  const [expectedSize, actualSize] = [sizes.expected, sizes.actual];
  if (expectedSize === null) return <MissingMedia attachment={expected} />;
  if (actualSize === null) return <MissingMedia attachment={actual} />;
  if (!expectedSize || !actualSize) return <div class="cmp-loading" />;
  const width = Math.max(expectedSize[0], actualSize[0]);
  const height = Math.max(expectedSize[1], actualSize[1]);
  const layer = (attachment: Attachment, size: Size, role: ComparisonRole) => (
    <img
      class="cmp-layer"
      src={fileHref(attachment.path ?? '')}
      alt={`${ROLE_LABELS[role]} (${set.group})`}
      style={{ width: `${(size[0] / width) * 100}%` }}
      onClick={onImageClick}
    />
  );
  return (
    <>
      <div class="cmp-stack" style={{ '--w': width, '--h': height }}>
        {layer(expected, expectedSize, 'expected')}
        <div class="cmp-top" style={mode === 'slider' ? { clipPath: `inset(0 0 0 ${divider}%)` } : { opacity: opacity / 100 }}>
          {layer(actual, actualSize, 'actual')}
        </div>
        {mode === 'slider' && (
          <>
            <input
              type="range"
              class="cmp-range"
              min={0}
              max={100}
              value={divider}
              aria-label="Divider position"
              aria-describedby={hintId}
              aria-valuetext={`${divider}%`}
              onInput={(event) => setDivider(Number(event.currentTarget.value))}
            />
            <span class="cmp-divider" style={{ left: `${divider}%` }} />
          </>
        )}
      </div>
      {mode === 'slider' && (
        <p class="cmp-hint" id={hintId}>
          Drag the divider, or use the arrow keys: expected on the left, actual on the right.
        </p>
      )}
      {mode === 'overlay' && (
        <label class="cmp-opacity">
          Actual opacity
          <input type="range" min={0} max={100} value={opacity} aria-valuetext={`${opacity}%`} onInput={(event) => setOpacity(Number(event.currentTarget.value))} />
          <output>{opacity}%</output>
        </label>
      )}
    </>
  );
}

export function ComparisonViewer({ set, onImageClick }: { set: ComparisonSet; onImageClick?: (() => void) | undefined }) {
  const modes = comparisonModes(set);
  const mode = pickMode(modes, chosenMode.value);
  const sizes = useNaturalSizes(set);
  const { expected, actual, diff } = set.images;
  const image = (role: ComparisonRole) => {
    const attachment = set.images[role];
    return attachment && <MediaImage key={attachment.path} attachment={attachment} alt={`${ROLE_LABELS[role]} (${set.group})`} class="cmp-image" onClick={onImageClick} />;
  };
  const bothSizes = sizes.expected && sizes.actual ? ([sizes.expected, sizes.actual] as const) : null;
  const differ = bothSizes && (bothSizes[0][0] !== bothSizes[1][0] || bothSizes[0][1] !== bothSizes[1][1]);

  return (
    <div class="comparison">
      <div class="cmp-modes" role="group" aria-label="Comparison mode">
        {modes.map((candidate) => (
          <button key={candidate} type="button" class="button toggle-button" aria-pressed={candidate === mode} onClick={() => (chosenMode.value = candidate)}>
            {MODE_LABELS[candidate]}
          </button>
        ))}
      </div>
      {mode === 'diff' && image('diff')}
      {mode === 'side' && (
        // Once both sizes are known, both images at the same scale: each takes a share of the row equal to its natural width.
        <div class={`cmp-side${bothSizes ? ' cmp-scaled' : ''}`} style={bothSizes ? { '--w': bothSizes[0][0] + bothSizes[1][0], '--h': Math.max(bothSizes[0][1], bothSizes[1][1]) } : undefined}>
          {(['expected', 'actual'] as const).map((role, index) => (
            <figure key={role} style={bothSizes ? { flexGrow: bothSizes[index]![0] } : undefined}>
              <figcaption>{ROLE_LABELS[role]}</figcaption>
              {image(role)}
            </figure>
          ))}
        </div>
      )}
      {(mode === 'slider' || mode === 'overlay') && <Stack set={set} sizes={sizes} mode={mode} onImageClick={onImageClick} />}
      <p class="cmp-sizes">
        {([['expected', expected], ['actual', actual], ['diff', diff]] as const).map(
          ([role, attachment]) =>
            attachment && (
              <span key={role}>
                {attachment.path ? (
                  <a href={fileHref(attachment.path)} target="_blank" rel="noopener">
                    {ROLE_LABELS[role]}
                  </a>
                ) : (
                  ROLE_LABELS[role]
                )}{' '}
                {sizeText(sizes[role])}
              </span>
            ),
        )}
        {differ && <strong class="cmp-differ">Expected and actual sizes differ</strong>}
      </p>
    </div>
  );
}

/** A comparison in the test detail, with a button opening it in the lightbox. */
export function ComparisonCard({ set, open }: { set: ComparisonSet; open: () => void }) {
  return (
    <article class="comparison-card" aria-label={`Screenshot comparison ${set.group}`}>
      <div class="comparison-head">
        <h4>{set.group}</h4>
        <button type="button" class="button" onClick={open}>
          Open in viewer
        </button>
      </div>
      <ComparisonViewer set={set} />
    </article>
  );
}
