import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MIN_PLAYWRIGHT_INSTALLABLE,
  MIN_PLAYWRIGHT_SUPPORTED,
  SUPPORT_URL,
  isBelow,
  parseMinorVersion,
  playwrightVersionWarning,
} from '../src/core/support.js';
import { ROOT } from './helpers/fixtures.js';

/**
 * The `on:` block of a workflow, read by indentation: each event, then each of
 * its keys with its values (a flow list `['a', 'b']`, a block list of `- a`
 * items, or a scalar). Comments and blank lines are ignored. Enough for the
 * triggers of ci.yml; not a YAML parser.
 */
function workflowTriggers(workflow: string): Map<string, Map<string, string[]>> {
  const lines = workflow.split(/\r?\n/);
  const start = lines.findIndex((line) => /^on:\s*(#.*)?$/.test(line));
  const events = new Map<string, Map<string, string[]>>();
  if (start === -1) return events;
  const unquote = (value: string) => value.trim().replace(/^(['"])(.*)\1$/, '$2');
  let event: Map<string, string[]> | undefined;
  let key: string[] | undefined;
  for (const raw of lines.slice(start + 1)) {
    const line = raw.replace(/(^|\s)#.*$/, '').trimEnd();
    if (line.trim() === '') continue;
    // The next top-level key ends the block.
    if (!line.startsWith(' ')) break;
    const indent = line.length - line.trimStart().length;
    const text = line.trim();
    if (indent === 2) {
      event = new Map();
      key = undefined;
      events.set(text.replace(/:.*$/, ''), event);
    } else if (text.startsWith('- ')) {
      key?.push(unquote(text.slice(2)));
    } else if (event) {
      const [name = '', value = ''] = text.split(/:\s*/, 2);
      const list = /^\[(.*)\]$/.exec(value.trim());
      key = list ? (list[1] ?? '').split(',').map(unquote).filter((item) => item !== '') : value.trim() === '' ? [] : [unquote(value)];
      event.set(name, key);
    }
  }
  return events;
}

describe('parseMinorVersion', () => {
  it('reads major and minor', () => {
    expect(parseMinorVersion('1.64.1')).toEqual([1, 64]);
    expect(parseMinorVersion('1.57')).toEqual([1, 57]);
    expect(parseMinorVersion(' 2.0.0 ')).toEqual([2, 0]);
  });

  it('reads prereleases', () => {
    expect(parseMinorVersion('1.65.0-alpha-2026-10-28')).toEqual([1, 65]);
    expect(parseMinorVersion('1.64.1-beta-1792067398000')).toEqual([1, 64]);
  });

  it('returns null for a missing or unreadable version', () => {
    for (const version of [undefined, null, '', 'next', 'v1.57.0', '1', '1.57.0.1', 1.57]) {
      expect(parseMinorVersion(version), String(version)).toBeNull();
    }
  });
});

describe('playwrightVersionWarning', () => {
  it('warns below the supported floor', () => {
    expect(playwrightVersionWarning('1.55.0')).toBe(
      `Loupe: Playwright 1.55.0 is below the minimum supported version (${MIN_PLAYWRIGHT_SUPPORTED}). ` +
        `The report is generated, but some data may be missing or wrong. See ${SUPPORT_URL}`,
    );
    expect(playwrightVersionWarning('1.52.0')).not.toBeNull();
    expect(playwrightVersionWarning('0.99.0')).not.toBeNull();
  });

  it('does not warn on the supported floor or above, patches included', () => {
    for (const version of ['1.57.0', '1.57.3', '1.64.1', '2.0.0']) {
      expect(playwrightVersionWarning(version), version).toBeNull();
    }
  });

  it('compares prereleases by their minor version', () => {
    expect(playwrightVersionWarning('1.57.0-alpha-2025-11-01')).toBeNull();
    expect(playwrightVersionWarning('1.65.0-alpha-2026-10-28')).toBeNull();
    expect(playwrightVersionWarning('1.56.0-beta-1759000000000')).toMatch(/^Loupe: Playwright 1\.56\.0-beta-1759000000000 is below/);
  });

  it('does not warn when the version is missing or unreadable', () => {
    for (const version of [undefined, null, '', 'unknown', 'v1.50.0', 1.5]) {
      expect(playwrightVersionWarning(version), String(version)).toBeNull();
    }
  });
});

describe('Playwright floors', () => {
  it('keeps the installable floor at or below the supported floor', () => {
    expect(parseMinorVersion(MIN_PLAYWRIGHT_INSTALLABLE)).not.toBeNull();
    expect(parseMinorVersion(MIN_PLAYWRIGHT_SUPPORTED)).not.toBeNull();
    expect(isBelow(MIN_PLAYWRIGHT_SUPPORTED, MIN_PLAYWRIGHT_INSTALLABLE)).toBe(false);
  });

  it('matches the lower bound of the @playwright/test peer dependency', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      peerDependencies: Record<string, string>;
    };
    const range = pkg.peerDependencies['@playwright/test'] ?? '';
    // `^1.52.0` or `>=1.52.0 <2`: the lower bound is the first version of the range.
    const lower = /^(?:\^|>=\s*)(\d+\.\d+\.\d+)\b/.exec(range)?.[1];
    expect(lower, `peerDependencies["@playwright/test"] is "${range}"`).toBe(`${MIN_PLAYWRIGHT_INSTALLABLE}.0`);
  });

  it('has a CI job on each floor', () => {
    const ci = readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    const job = (version: string, role: string) => new RegExp(`playwright: ${version.replace('.', '\\.')}\\.0\\n\\s+role: ${role}\\n`);
    expect(ci).toMatch(job(MIN_PLAYWRIGHT_INSTALLABLE, 'minimum installable'));
    expect(ci).toMatch(job(MIN_PLAYWRIGHT_SUPPORTED, 'minimum supported'));
  });

  it('runs the history tests and the leak canary on Windows, without a browser, as the seventh release gate', () => {
    const ci = readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    // The job, up to the next job at the same indentation or the end of the file.
    const job = /^ {2}history-windows:\n((?: {4}.*\n|\n)+)/m.exec(ci)?.[1] ?? '';
    expect(job).toContain('name: History on Windows');
    expect(job).toContain('runs-on: windows-latest');
    expect(job).toMatch(/node-version: 24\n/);
    expect(job).toContain('run: npm ci');
    expect(job).toContain('run: npm run build');
    // `test/history` matches every history test file, the Windows lock tests included.
    expect(job).toContain('run: npx vitest run test/history test/leak.integration.test.ts');
    expect(job).not.toMatch(/playwright install|if:/);
    expect(existsSync(path.join(ROOT, 'test/history-windows-locks.test.ts'))).toBe(true);
    // Like the other jobs: on every branch push and pull request, never on a tag (a tag runs demo.yml), no path filter.
    const triggers = workflowTriggers(ci);
    expect([...triggers.keys()].sort()).toEqual(['pull_request', 'push']);
    expect([...(triggers.get('push')?.keys() ?? [])]).toEqual(['branches']);
    expect(triggers.get('push')?.get('branches')).toEqual(['**']);
    const releasing = readFileSync(path.join(ROOT, 'docs/releasing.md'), 'utf8');
    expect(releasing).toContain('the seven jobs of `.github/workflows/ci.yml` must be green');
    expect(releasing).toContain('`History on Windows`');
    expect(readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8')).toContain('seven jobs in `ci.yml`');
  });

  it('shows both floors in the README and the support documentation', () => {
    const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    const support = readFileSync(path.join(ROOT, 'docs/support.md'), 'utf8');
    const warning = `minimum supported version (${MIN_PLAYWRIGHT_SUPPORTED})`;
    // Right under the title: a static badge (never the peer dependency, which is the technical floor) and one line.
    expect(readme).toMatch(
      new RegExp(
        `^# playwright-loupe\\n\\n\\[!\\[Playwright ≥ ${MIN_PLAYWRIGHT_SUPPORTED}\\]\\(https://img\\.shields\\.io/badge/Playwright-%E2%89%A5%20${MIN_PLAYWRIGHT_SUPPORTED}-blue\\)\\]\\(docs/support\\.md\\)\\n\\n` +
          `Supports \\[Playwright ${MIN_PLAYWRIGHT_SUPPORTED} and later\\]\\(docs/support\\.md\\) `,
      ),
    );
    expect(readme).toContain(`| Supported floor | ${MIN_PLAYWRIGHT_SUPPORTED} |`);
    expect(readme).toContain(`| Minimum installable | ${MIN_PLAYWRIGHT_INSTALLABLE} |`);
    expect(readme).toContain(warning);
    expect(support).toContain(`| Supported floor | **${MIN_PLAYWRIGHT_SUPPORTED}** |`);
    expect(support).toContain(`| Minimum installable (technical floor) | **${MIN_PLAYWRIGHT_INSTALLABLE}** |`);
    expect(support).toContain(warning);
    expect(support).toContain(SUPPORT_URL);
  });
});
