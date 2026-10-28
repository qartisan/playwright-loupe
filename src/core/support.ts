/**
 * Playwright versions Loupe works with (docs/support.md). Both are
 * `major.minor`:
 *
 * - installable (technical floor): the lower bound of the `@playwright/test`
 *   peer dependency, the oldest version Loupe runs on without throwing or
 *   leaking secrets, tested in CI. Raised only when it must be.
 * - supported: the floor of the support policy (minor versions released in
 *   the twelve months before a Loupe release). Below it, Loupe still runs and
 *   writes one warning line.
 *
 * Tests keep `package.json` and the README in sync with these values.
 */
export const MIN_PLAYWRIGHT_INSTALLABLE = '1.52';
export const MIN_PLAYWRIGHT_SUPPORTED = '1.57';

export const SUPPORT_URL = 'https://github.com/qartisan/playwright-loupe/blob/main/docs/support.md';

/**
 * Major and minor of a version such as `1.64.1` or `1.65.0-alpha-2026-10-28`;
 * null when it cannot be read.
 */
export function parseMinorVersion(version: unknown): [number, number] | null {
  if (typeof version !== 'string') return null;
  const match = /^(\d+)\.(\d+)(?:\.\d+)?(?:[-+]\S*)?$/.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2])];
}

/** Whether `version` is a minor version older than `floor`; false when either cannot be read. */
export function isBelow(version: unknown, floor: string): boolean {
  const actual = parseMinorVersion(version);
  const minimum = parseMinorVersion(floor);
  if (!actual || !minimum) return false;
  return actual[0] < minimum[0] || (actual[0] === minimum[0] && actual[1] < minimum[1]);
}

/**
 * The run-time warning for a Playwright version below the supported floor;
 * null otherwise, and when the version is missing or cannot be read. A
 * prerelease of a supported minor version is supported.
 */
export function playwrightVersionWarning(version: unknown): string | null {
  if (!isBelow(version, MIN_PLAYWRIGHT_SUPPORTED)) return null;
  return (
    `Loupe: Playwright ${String(version).trim()} is below the minimum supported version (${MIN_PLAYWRIGHT_SUPPORTED}). ` +
    `The report is generated, but some data may be missing or wrong. See ${SUPPORT_URL}`
  );
}
