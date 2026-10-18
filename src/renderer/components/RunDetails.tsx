import type { LoupeReport } from '../../schema/v1.js';
import { runDetails } from '../runDetails.js';
import { CopyButton } from './CopyButton.js';
import { Widget } from './widgets.js';

/**
 * Run metadata on the Overview, in three columns (Run, Code, Environment)
 * that stack on narrow screens, each a description list under its heading.
 * The commit is short, with the full hash in the tooltip and a copy button. Plain text: no links,
 * which would need provider-specific URL rules. The header keeps the start
 * date and the environment, so they are not repeated here.
 */
export function RunDetails({ report }: { report: Pick<LoupeReport, 'run' | 'generator'> }) {
  return (
    <Widget id="w-run-details" class="widget-run-details" title="Run details">
      <div class="run-details">
        {runDetails(report).map(({ title, rows }) => (
          <div key={title} class="run-details-group">
            <h3 id={`run-details-${title.toLowerCase()}`}>{title}</h3>
            <dl aria-labelledby={`run-details-${title.toLowerCase()}`}>
              {rows.map(({ label, value, full }) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>
                    {full === undefined ? (
                      value
                    ) : (
                      <>
                        <code title={full}>{value}</code>
                        <CopyButton label="Commit hash" help={full} text={() => full}>
                          Copy<span class="visually-hidden"> commit hash</span>
                        </CopyButton>
                      </>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </Widget>
  );
}
