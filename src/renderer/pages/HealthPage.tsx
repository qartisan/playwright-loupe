import { useMemo } from 'preact/hooks';
import type { LoupeReport } from '../../schema/v1.js';
import { categoryColorMap } from '../categoryColors.js';
import { DimensionWidget, FlakyWidget, SkippedWidget, SlowestWidget } from '../components/widgets.js';
import { dimensionDistributions, flakyTests, skippedTests, slowestTests } from '../dashboard.js';

/** Suite health (`#/health`): dimensions and tag hygiene, then slow, skipped and flaky tests. */
export function HealthPage({ report }: { report: LoupeReport }) {
  const data = useMemo(
    () => ({
      dimensions: dimensionDistributions(report).filter((distribution) => distribution.values.length > 0),
      slowest: slowestTests(report),
      skipped: skippedTests(report),
      flaky: flakyTests(report),
    }),
    [report],
  );
  const colors = useMemo(() => categoryColorMap(report.categories), [report]);
  const empty = data.dimensions.length + data.slowest.length + data.skipped.length + data.flaky.length === 0;

  return (
    <div class="page view view-health">
      <h1>Suite health</h1>
      {empty && <p class="muted">No dimension, slow, skipped or flaky test to show for this run.</p>}
      {data.dimensions.length > 0 && (
        <div class="widget-grid dimension-grid">
          {data.dimensions.map((distribution) => (
            <DimensionWidget key={distribution.definition.name} distribution={distribution} />
          ))}
        </div>
      )}
      {(data.slowest.length > 0 || data.skipped.length > 0 || data.flaky.length > 0) && (
        <div class="widget-grid">
          {data.slowest.length > 0 && <SlowestWidget tests={data.slowest} />}
          {data.flaky.length > 0 && <FlakyWidget tests={data.flaky} colors={colors} />}
          {data.skipped.length > 0 && <SkippedWidget tests={data.skipped} />}
        </div>
      )}
    </div>
  );
}
