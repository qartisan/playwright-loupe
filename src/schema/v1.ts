/**
 * Loupe JSON report — schema v1. This file is the source of truth for the
 * public contract; `docs/schema/report-v1.schema.json` mirrors it and
 * `docs/schema/v1.md` documents every field and rule.
 *
 * Any change to the shape below requires a new `schemaVersion` (see the
 * versioning policy in `docs/schema/v1.md`).
 *
 * Enumerations are declared as runtime constants so the JSON Schema test can
 * check that both sides list the same values. Kept free of Node imports so the
 * renderer can import it too.
 */

export const SCHEMA_VERSION = 1;

export const RUN_STATUSES = ['passed', 'failed', 'timedout', 'interrupted'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_SCOPES = ['full', 'partial'] as const;
export type RunScope = (typeof RUN_SCOPES)[number];

export const OUTCOMES = ['passed', 'failed', 'flaky', 'skipped'] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const ATTEMPT_STATUSES = ['passed', 'failed', 'timedOut', 'skipped', 'interrupted'] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export const ATTACHMENT_KINDS = ['screenshot', 'video', 'trace', 'text', 'other'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const COMPARISON_ROLES = ['expected', 'actual', 'diff'] as const;
export type ComparisonRole = (typeof COMPARISON_ROLES)[number];

export const DIMENSION_SOURCES = ['tag', 'annotation'] as const;
export type DimensionSource = (typeof DIMENSION_SOURCES)[number];

export interface LoupeReport {
  schemaVersion: 1;
  generator: { name: 'playwright-loupe'; version: string };
  run: Run;
  projects: Project[];
  tests: TestCase[];
  /** Category definitions actually used in this report. */
  categories: CategoryDefinition[];
  /** Dimension definitions actually used in this report. */
  dimensions: DimensionDefinition[];
}

export interface Run {
  /** Random UUID generated at onBegin. */
  id: string;
  /** ISO 8601. */
  startedAt: string;
  durationMs: number;
  status: RunStatus;
  scope: RunScope;
  /** Why the run was considered partial, e.g. ['grep', 'file-filter']. Empty when full. */
  scopeReasons: string[];
  playwrightVersion: string;
  workers: number;
  shard: { current: number; total: number } | null;
  environment: {
    /** From LOUPE_ENV, null otherwise. */
    name: string | null;
    ci: boolean;
    /** 'github-actions', 'gitlab', ... when detectable. */
    ciProvider: string | null;
    /** Platform and architecture, e.g. 'linux-x64'. */
    os: string;
    nodeVersion: string;
  };
  git: {
    commit: string | null;
    branch: string | null;
    remote: string | null;
  };
  /** Phase 2 slot: always null in v1. */
  excluded: { reason: string } | null;
  /** Phase 2 slot: always [] in v1. */
  notes: Note[];
  stats: Stats;
}

export interface Note {
  createdAt: string;
  author: string | null;
  text: string;
  /** Test id when the note targets a test result; null for a run-level note. */
  testId: string | null;
}

export interface Stats {
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
}

export interface Project {
  name: string;
  /** Relative to the Playwright root dir, POSIX separators ('.' when equal). */
  testDir: string;
  retries: number;
  timeoutMs: number;
  stats: Stats;
}

export interface SourceLocation {
  /** Relative to the Playwright root dir, POSIX separators. */
  file: string;
  line: number;
  column: number;
}

export interface TestCase {
  /** Stable id: first 16 hex chars of sha256(project + '\0' + file + '\0' + [...suitePath, title].join('\0')). */
  id: string;
  /**
   * 0 unless the run used `--repeat-each`, which yields several tests with the
   * same `id`. The pair (id, repeatEachIndex) is unique within a report.
   */
  repeatEachIndex: number;
  project: string;
  /** Relative to the Playwright root dir, POSIX separators. */
  file: string;
  line: number;
  column: number;
  /** describe() titles only — no project, no file, no test title. */
  suitePath: string[];
  title: string;
  /** As declared, with the leading '@'. */
  tags: string[];
  annotations: Annotation[];
  /** Final outcome; a test.fail() that fails as expected is 'passed'. */
  outcome: Outcome;
  expectedStatus: AttemptStatus;
  /** Sum of all attempts. */
  durationMs: number;
  /** Computed: dimension name → values. */
  dimensions: Record<string, string[]>;
  /** From the last failing attempt; null when the test never failed. */
  category: string | null;
  errorSignature: string | null;
  attempts: Attempt[];
}

export interface Annotation {
  type: string;
  description: string | null;
}

export interface Attempt {
  /** 0 for the first run, 1 for the first retry, ... */
  index: number;
  status: AttemptStatus;
  startedAt: string;
  durationMs: number;
  workerIndex: number;
  errors: LoupeError[];
  steps: Step[];
  attachments: Attachment[];
  annotations: Annotation[];
  /** Truncated to a fixed size, with a flag when truncated. */
  stdout: Output;
  stderr: Output;
}

export interface Output {
  text: string;
  truncated: boolean;
}

export interface LoupeError {
  /** ANSI codes stripped. */
  message: string;
  stack: string | null;
  location: SourceLocation | null;
  snippet: string | null;
  signature: string;
  category: string | null;
}

export interface Step {
  title: string;
  /** Playwright step subtitle (e.g. the target locator of a `pw:api` step); null when absent. */
  subtitle: string | null;
  /** Playwright step category: 'test.step', 'expect', 'pw:api', 'hook', 'fixture', ... */
  category: string;
  durationMs: number;
  error: LoupeError | null;
  location: SourceLocation | null;
  steps: Step[];
}

export interface Attachment {
  name: string;
  contentType: string;
  kind: AttachmentKind;
  /** Relative to the report folder; null when the body is inlined or the file is missing. */
  path: string | null;
  /** Inline only for small text bodies. */
  body: string | null;
  /** Set for toHaveScreenshot / toMatchSnapshot images. */
  comparison: { group: string; role: ComparisonRole } | null;
}

export interface CategoryDefinition {
  name: string;
  color: string;
  builtIn: boolean;
}

export interface DimensionDefinition {
  name: string;
  source: DimensionSource;
  /** Tag prefix (without '@' and ':') or annotation type. */
  key: string;
}
