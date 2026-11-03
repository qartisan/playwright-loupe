import type { Attachment } from '../../schema/v1.js';
import { attemptLabel } from '../detail/attempts.js';
import { absoluteFilePath, fileHref, traceCommand, traceHelp, traceViewerFolder, traceViewerHref } from '../detail/media.js';
import { CopyButton } from './CopyButton.js';
import { NewTabIcon } from './icons.js';

/**
 * A trace: the command opening it in Playwright's trace viewer, to copy, and
 * a download link. When the report bundles the trace viewer and is served
 * over http(s) in a secure context, a link first opens the trace in it, in a
 * new tab. Otherwise the report cannot open the trace itself. Over file://,
 * the command holds the trace's absolute path, computed from the page's own
 * location.
 *
 * @param traceViewer the `traceViewer` renderer setting
 * @param attempt index of the attempt the trace belongs to
 */
export function TraceCard({
  attachment,
  playwrightVersion,
  traceViewer,
  attempt,
}: {
  attachment: Attachment;
  playwrightVersion: string;
  traceViewer: string | null;
  attempt: number;
}) {
  const { path } = attachment;
  const pageUrl = window.location.href;
  const help = traceHelp(playwrightVersion, path !== null && absoluteFilePath(path, pageUrl) !== null);
  const viewer = traceViewerFolder(traceViewer, window);
  return (
    <div class="trace-card">
      <span class="attachment-name">{attachment.name}</span>
      {path ? (
        <>
          <div class="trace-actions">
            {viewer && (
              <a
                class="button trace-open"
                href={traceViewerHref(viewer, path, pageUrl)}
                target="_blank"
                rel="noopener"
                aria-label={`Open in Trace Viewer: ${attachment.name}, ${attemptLabel(attempt)}, in a new tab`}
              >
                <span>Open in Trace Viewer</span>
                <NewTabIcon />
              </a>
            )}
            <CopyButton label="Trace command" help={help} text={() => traceCommand(path, pageUrl)}>
              Copy trace command
            </CopyButton>
            <a class="button trace-download" href={fileHref(path)} download={path.slice(path.lastIndexOf('/') + 1)}>
              Download trace
            </a>
          </div>
          <p class="trace-help">{help}</p>
        </>
      ) : (
        <span class="muted">(file missing)</span>
      )}
    </div>
  );
}
