import type { Attachment } from '../../schema/v1.js';
import { fileHref, traceCommand, traceHelp } from '../detail/media.js';
import { CopyButton } from './CopyButton.js';

/**
 * A trace: the command opening it in Playwright's trace viewer, to copy, and
 * a download link. The trace viewer needs an HTTP server, so the report does
 * not open it itself.
 */
export function TraceCard({ attachment, playwrightVersion }: { attachment: Attachment; playwrightVersion: string }) {
  const { path } = attachment;
  const help = traceHelp(playwrightVersion);
  return (
    <div class="trace-card">
      <span class="attachment-name">{attachment.name}</span>
      {path ? (
        <>
          <div class="trace-actions">
            <CopyButton label="Trace command" help={help} text={() => traceCommand(path)}>
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
