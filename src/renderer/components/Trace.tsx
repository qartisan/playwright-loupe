import type { Attachment } from '../../schema/v1.js';
import { absoluteFilePath, fileHref, traceCommand, traceHelp } from '../detail/media.js';
import { CopyButton } from './CopyButton.js';

/**
 * A trace: the command opening it in Playwright's trace viewer, to copy, and
 * a download link. The trace viewer needs an HTTP server, so the report does
 * not open it itself. Over file://, the command holds the trace's absolute
 * path, computed from the page's own location.
 */
export function TraceCard({ attachment, playwrightVersion }: { attachment: Attachment; playwrightVersion: string }) {
  const { path } = attachment;
  const pageUrl = window.location.href;
  const help = traceHelp(playwrightVersion, path !== null && absoluteFilePath(path, pageUrl) !== null);
  return (
    <div class="trace-card">
      <span class="attachment-name">{attachment.name}</span>
      {path ? (
        <>
          <div class="trace-actions">
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
