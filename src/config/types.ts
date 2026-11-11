import type { StreamKeyPart } from '../schema/history-v1.js';

/**
 * Loupe configuration, as written in `loupe.config.ts` or passed inline as
 * reporter options. Every option is optional; see docs/config.md.
 */

export const CATEGORY_MODES = ['extend', 'replace'] as const;
export type CategoryMode = (typeof CATEGORY_MODES)[number];

export const REDACT_MODES = ['extend', 'replace'] as const;
export type RedactMode = (typeof REDACT_MODES)[number];

export const CATEGORY_TARGETS = ['message', 'stack', 'step', 'all'] as const;
export type CategoryTarget = (typeof CATEGORY_TARGETS)[number];

export const SCREENSHOT_VIEWS = ['side-by-side', 'slider', 'overlay', 'diff'] as const;
export type ScreenshotView = (typeof SCREENSHOT_VIEWS)[number];

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const TRACE_VIEWERS = ['off', 'bundled'] as const;
export type TraceViewer = (typeof TRACE_VIEWERS)[number];

export const HISTORY_INCLUDES = ['full', 'all'] as const;
export type HistoryInclude = (typeof HISTORY_INCLUDES)[number];

export { STREAM_KEY_PARTS, type StreamKeyPart } from '../schema/history-v1.js';

export interface CategoryRuleConfig {
  /** Category name. Several rules may share a name. */
  name: string;
  /** One pattern or a list; the rule matches when any pattern matches. */
  match: RegExp | RegExp[];
  /** What the patterns are tested against. Default: `'all'`. */
  on?: CategoryTarget;
  /**
   * `#rrggbb`, or the name of a palette color: `blue`, `cyan`, `teal`,
   * `violet`, `magenta`, `orange`, `brown`, `gold`. Default: the first
   * palette color no other category of the report uses, in rule order.
   */
  color?: string;
}

export interface CategoriesConfig {
  /** `extend` (default): rules run before the built-in ones. `replace`: built-in rules are dropped. */
  mode?: CategoryMode;
  rules?: CategoryRuleConfig[];
  /** Name of the bucket for errors no rule matches. Default: `Uncategorized`. */
  uncategorized?: string;
}

export interface TagDimensionConfig {
  name: string;
  from: 'tag';
  /** Tag prefix, without `@` and `:`: `layer` for `@layer:api`. */
  prefix: string;
  /** Expected values. */
  values?: string[];
}

export interface AnnotationDimensionConfig {
  name: string;
  from: 'annotation';
  /** Annotation type; the annotation description is the value. */
  type: string;
  /** Expected values. */
  values?: string[];
}

export type DimensionConfig = TagDimensionConfig | AnnotationDimensionConfig;

export interface DimensionsConfig {
  /** Keep the automatic dimensions built from prefixed tags. Default: `true`. */
  auto?: boolean;
  definitions?: DimensionConfig[];
}

export interface RedactConfig {
  /**
   * Secret-looking names, for input step targets and source lines, and for
   * HTTP header names. A string matches whole words (`auth` matches
   * `x-auth-token`, not `Author`); a RegExp is tested as is.
   */
  patterns?: Array<string | RegExp>;
  /** `extend` (default): `patterns` add to the default names. `replace`: only `patterns`; `[]` turns name-based redaction off. */
  mode?: RedactMode;
  /** Names of environment variables whose values are redacted everywhere in the report. Names only, never values. */
  env?: string[];
}

export interface LoupeConfig {
  /** Folder the report is written to, relative to the Playwright config file. Default: `loupe-report`. */
  outputFolder?: string;
  /** Report title. Default: `Loupe report`. */
  title?: string;
  /** Environment name written to `run.environment.name`. `LOUPE_ENV` overrides it. */
  environment?: string;
  categories?: CategoriesConfig;
  dimensions?: DimensionsConfig;
  screenshots?: {
    /** Default comparison view in the test detail. Default: `side-by-side`. */
    defaultView?: ScreenshotView;
  };
  /** Default theme of the report. Default: `system`. */
  theme?: Theme;
  aiPrompt?: {
    /** Include each error's stack trace in the copyable AI prompt. Default: `true`. */
    includeStack?: boolean;
  };
  /** Secret redaction in report.json and index.html. `LOUPE_REDACT_ENV` adds variable names. */
  redact?: RedactConfig;
  git?: {
    /**
     * Read commit, branch and remote from the local repository when Playwright
     * and the CI variables do not give them. `LOUPE_GIT_LOCAL` overrides it.
     * Default: `true`.
     */
    local?: boolean;
  };
  /**
   * `bundled` copies the trace viewer of the project's Playwright (1.61 or
   * later) into the report folder when the run has traces. `LOUPE_TRACE_VIEWER`
   * overrides it. Default: `off`.
   */
  traceViewer?: TraceViewer;
  /** Run history, recorded in `loupe-history/` by default. `false` turns it off. See docs/history.md. */
  history?: boolean | HistoryConfig;
}

export interface HistoryConfig {
  /** Record runs and embed their history in the report. `LOUPE_HISTORY` overrides it. Default: `true`. */
  enabled?: boolean;
  /**
   * History folder, relative to the Playwright config file; never inside
   * `outputFolder`, nor containing it. `LOUPE_HISTORY_DIR` (relative to the
   * working directory) overrides it. Default: `loupe-history`.
   */
  dir?: string;
  stream?: {
    /** What makes a stream; retention and comparisons stay within one. Default: `['environment', 'origin']`. */
    key?: StreamKeyPart[];
  };
  /** Per stream; the first limit reached wins. */
  retention?: {
    /** Default: `200`. */
    maxRuns?: number;
    /** Default: `90`. */
    maxAgeDays?: number;
  };
  /** `full` (default): partial, excluded and IDE runs are left out of run-level statistics. `all`: they count. */
  include?: HistoryInclude;
}

/** Inline reporter options: a config, plus the path of the config file. */
export interface LoupeReporterOptions extends LoupeConfig {
  /** Config file to load instead of the default lookup, relative to the Playwright config file. */
  configFile?: string;
}

/** A category rule with defaults applied; patterns never carry the `g` or `y` flag. */
export interface ResolvedCategoryRule {
  name: string;
  match: RegExp[];
  on: CategoryTarget;
  /** `#rrggbb` (palette names are resolved to their reference color); null when not configured. */
  color: string | null;
}

export type ResolvedDimension =
  | { name: string; from: 'tag'; prefix: string; values: string[] | null }
  | { name: string; from: 'annotation'; type: string; values: string[] | null };

/** The config after defaults and every layer are applied. */
export interface ResolvedConfig {
  /** Absolute path of the loaded config file, null when none. */
  configFile: string | null;
  /** Absolute. */
  outputFolder: string;
  title: string;
  environment: string | null;
  categories: { mode: CategoryMode; rules: ResolvedCategoryRule[]; uncategorized: string };
  dimensions: { auto: boolean; definitions: ResolvedDimension[] };
  screenshots: { defaultView: ScreenshotView };
  theme: Theme;
  aiPrompt: { includeStack: boolean };
  /** RegExps without the `g` and `y` flags; `env` merged from every layer, without duplicates. */
  redact: { mode: RedactMode; patterns: Array<string | RegExp>; env: string[] };
  git: { local: boolean };
  traceViewer: TraceViewer;
  history: ResolvedHistory;
}

export interface ResolvedHistory {
  /** False when turned off, or when the default folder overlaps `outputFolder` (with a warning). */
  enabled: boolean;
  /** Absolute. */
  dir: string;
  stream: { key: StreamKeyPart[] };
  retention: { maxRuns: number; maxAgeDays: number };
  include: HistoryInclude;
}
