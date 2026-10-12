/**
 * PLACEHOLDER MODEL — schemaVersion 0.
 *
 * This is a deliberately minimal shape used to wire the reporter → JSON → HTML
 * pipeline end to end. It is NOT the public contract: the real JSON schema v1
 * (stable test identity, all attempts with attachments, error signatures,
 * dimensions, run metadata) comes in the next brief and will replace it.
 *
 * Kept free of runtime imports so the renderer can import these types too.
 */

export type PlaceholderRunStatus = 'passed' | 'failed' | 'timedout' | 'interrupted';

export type PlaceholderTestStatus = 'passed' | 'failed' | 'flaky' | 'skipped';

export interface PlaceholderTest {
  /** Describe blocks and test title, without the project and file segments. */
  titlePath: string[];
  project: string;
  /** Path relative to the Playwright root dir, POSIX separators. */
  file: string;
  status: PlaceholderTestStatus;
  attempts: number;
}

export interface PlaceholderReport {
  schemaVersion: 0;
  run: {
    title: string;
    /** ISO 8601. */
    startTime: string;
    /** Milliseconds. */
    duration: number;
    playwrightVersion: string;
    status: PlaceholderRunStatus;
  };
  tests: PlaceholderTest[];
}
