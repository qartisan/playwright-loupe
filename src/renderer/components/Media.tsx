import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Attachment } from '../../schema/v1.js';
import { attemptMedia, fileHref, viewerItems, type ViewerItem } from '../detail/media.js';
import { currentLocation } from '../navigation.js';
import { isTextField } from '../shortcuts.js';
import { ComparisonCard, ComparisonViewer } from './Comparison.js';
import { Dialog } from './Dialog.js';
import { AttachmentItem } from './TestDetail.js';

/**
 * Attachments of an attempt, with viewers: screenshot comparisons and
 * thumbnails opening a lightbox, inline videos, then the other files as links. Files stay next to
 * the report (`data/`), referenced by relative links: nothing is inlined.
 */

/** In place of an image or a video that cannot be shown: its name and path, never a broken icon. */
export function MissingMedia({ attachment, note = 'File not found' }: { attachment: Attachment; note?: string }) {
  return (
    <span class="media-missing">
      <strong>{attachment.name}</strong>
      <span>{note}</span>
      <code>{attachment.path ?? 'no file in the report'}</code>
    </span>
  );
}

/** An image attachment; a missing file shows `MissingMedia`. Keyed by path at call sites, so a new file is tried again. */
export function MediaImage({
  attachment,
  alt = attachment.name,
  lazy = false,
  class: className,
  onClick,
}: {
  attachment: Attachment;
  alt?: string;
  lazy?: boolean;
  class?: string;
  onClick?: (() => void) | undefined;
}) {
  const [failed, setFailed] = useState(false);
  if (!attachment.path || failed) return <MissingMedia attachment={attachment} />;
  return (
    <img
      src={fileHref(attachment.path)}
      alt={alt}
      class={className}
      loading={lazy ? 'lazy' : undefined}
      decoding="async"
      onError={() => setFailed(true)}
      onClick={onClick}
    />
  );
}

export function OpenOriginal({ attachment, label = 'Open original' }: { attachment: Attachment; label?: string }) {
  if (!attachment.path) return null;
  return (
    <a class="open-original" href={fileHref(attachment.path)} target="_blank" rel="noopener">
      {label}
    </a>
  );
}

function Thumbnails({ screenshots, open }: { screenshots: readonly Attachment[]; open: (index: number) => void }) {
  return (
    <ul class="thumbs">
      {screenshots.map((attachment, index) => (
        <li key={index}>
          <button type="button" class="thumb" onClick={() => open(index)}>
            <MediaImage key={attachment.path} attachment={attachment} lazy />
            <span class="thumb-name" aria-hidden="true">
              {attachment.name}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** `←` / `→` while the lightbox is open, except where arrows already mean something (a slider, a text field). */
function useViewerKeys(active: boolean, move: (offset: number) => void): void {
  // The latest `move`, so a key pressed right after a render never sees the previous position.
  const latest = useRef(move);
  latest.current = move;
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      const offset = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
      if (!offset || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      if (isTextField(event.target) || (event.target instanceof HTMLInputElement && event.target.type === 'range')) return;
      event.preventDefault();
      latest.current(offset);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [active]);
}

/**
 * The screenshots and comparisons of an attempt in a modal dialog, one at a
 * time: fitted to the viewport, or at actual size (scrollable) by clicking
 * the image or the "Actual size" button. Previous / next and `←` / `→`,
 * without wrapping. A comparison keeps its modes.
 */
function Lightbox({ items, index, setIndex }: { items: readonly ViewerItem[]; index: number | null; setIndex: (index: number | null) => void }) {
  // The index shown at actual size: another item starts fitted.
  const [actualIndex, setActualIndex] = useState<number | null>(null);
  const actualSize = index !== null && actualIndex === index;
  const item = index === null ? undefined : items[index];
  const move = (offset: number): void => {
    if (index !== null && items[index + offset]) setIndex(index + offset);
  };
  useViewerKeys(item !== undefined, move);
  const toggle = (): void => setActualIndex(actualSize ? null : index);

  return (
    <Dialog
      open={item !== undefined}
      onClose={() => {
        setIndex(null);
        setActualIndex(null);
      }}
      title={item ? (item.type === 'image' ? item.attachment.name : item.set.group) : ''}
      class={`lightbox${actualSize ? ' actual-size' : ''}`}
      actions={item?.type === 'image' && <OpenOriginal attachment={item.attachment} />}
    >
      {item && index !== null && (
        <>
          <div
            class="lightbox-stage"
            onClick={(event) => {
              if (event.target === event.currentTarget) setIndex(null);
            }}
          >
            {item.type === 'image' ? (
              <MediaImage key={item.attachment.path} attachment={item.attachment} class="lightbox-image" onClick={toggle} />
            ) : (
              <ComparisonViewer key={item.set.group} set={item.set} onImageClick={toggle} />
            )}
          </div>
          <div class="lightbox-bar">
            <button type="button" class="button pager-button" disabled={index === 0} onClick={() => move(-1)}>
              ← Previous
            </button>
            <span class="lightbox-position" aria-live="polite">
              {index + 1} of {items.length}
            </span>
            <button type="button" class="button pager-button" disabled={index === items.length - 1} onClick={() => move(1)}>
              Next →
            </button>
            <button type="button" class="button toggle-button" aria-pressed={actualSize} onClick={toggle}>
              Actual size
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}

function Video({ attachment }: { attachment: Attachment }) {
  const [failed, setFailed] = useState(false);
  return (
    <figure class="video">
      {attachment.path && !failed ? (
        <video controls preload="metadata">
          {/* The error event of the last <source> says that no source can play. */}
          <source src={fileHref(attachment.path)} type={attachment.contentType} onError={() => setFailed(true)} />
        </video>
      ) : (
        <MissingMedia attachment={attachment} note={attachment.path ? 'Cannot play this video' : 'File not found'} />
      )}
      <figcaption>
        <span class="attachment-name">{attachment.name}</span>
        <OpenOriginal attachment={attachment} />
      </figcaption>
    </figure>
  );
}

function Section({ label, count, children }: { label: string; count: number; children: ComponentChildren }) {
  if (count === 0) return null;
  return (
    <section class="attachment-group" aria-label={label}>
      <h3>
        {label} <span class="muted">{count}</span>
      </h3>
      {children}
    </section>
  );
}

function FileList({ attachments }: { attachments: readonly Attachment[] }) {
  return (
    <ul class="attachment-list">
      {attachments.map((attachment, index) => (
        <li key={index}>
          <AttachmentItem attachment={attachment} />
        </li>
      ))}
    </ul>
  );
}

/**
 * The attachments of one attempt. Keyed by attempt at the call site; the
 * lightbox also closes on any route change (Back, another test), and its
 * state is never in the URL.
 */
export function Attachments({ attachments }: { attachments: readonly Attachment[] }) {
  const media = attemptMedia(attachments);
  // A new object on each opening: opening again right after Escape, before the closing rendered, still renders.
  const [viewer, setViewer] = useState<{ index: number } | null>(null);
  const setIndex = (index: number | null): void => setViewer(index === null ? null : { index });
  const location = currentLocation.value;
  useEffect(() => setViewer(null), [location]);
  const text = media.files.filter((attachment) => attachment.kind === 'text');
  const other = media.files.filter((attachment) => attachment.kind !== 'text');

  return (
    <div class="attachment-groups">
      <Section label="Screenshots" count={media.comparisons.length + media.screenshots.length}>
        {media.comparisons.map((set, position) => (
          <ComparisonCard key={set.group} set={set} open={() => setIndex(position)} />
        ))}
        {media.screenshots.length > 0 && <Thumbnails screenshots={media.screenshots} open={(position) => setIndex(media.comparisons.length + position)} />}
      </Section>
      <Section label="Videos" count={media.videos.length}>
        {media.videos.map((attachment, position) => (
          <Video key={`${position}/${attachment.path}`} attachment={attachment} />
        ))}
      </Section>
      <Section label="Traces" count={media.traces.length}>
        <FileList attachments={media.traces} />
      </Section>
      <Section label="Text" count={text.length}>
        <FileList attachments={text} />
      </Section>
      <Section label="Other" count={other.length}>
        <FileList attachments={other} />
      </Section>
      <Lightbox items={viewerItems(media)} index={viewer?.index ?? null} setIndex={setIndex} />
    </div>
  );
}
