import { readFileSync } from 'node:fs';
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
        `The report is generated, but some data may be missing or wrong. See ${SUPPORT_URL}.`,
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
});
