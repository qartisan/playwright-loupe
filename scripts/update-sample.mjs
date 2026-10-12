// Copies the fixture report (written by `npm run fixtures`) to the renderer's
// dev sample, so the Vite dev server runs on real schema v1 data.
// Absolute paths of this machine (in stack traces) are replaced by `<root>/`.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = new URL('../loupe-report/report.json', import.meta.url);
const target = new URL('../src/renderer/dev/sample.json', import.meta.url);

if (!existsSync(source)) {
  console.error('update-sample: loupe-report/report.json not found, run `npm run fixtures` first.');
  process.exit(1);
}

const report = JSON.parse(readFileSync(source, 'utf8'));
if (report.schemaVersion !== 1) {
  console.error(`update-sample: expected schemaVersion 1, got ${report.schemaVersion}.`);
  process.exit(1);
}

const json = JSON.stringify(report, null, 2).replaceAll(JSON.stringify(root).slice(1, -1), '<root>/');
writeFileSync(target, `${json}\n`);
console.log(`update-sample: wrote ${fileURLToPath(target)} (${report.tests.length} tests).`);
