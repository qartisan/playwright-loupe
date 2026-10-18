/**
 * Loupe configuration, as written in `loupe.config.ts` or passed inline as
 * reporter options. Every option is optional; see docs/config.md.
 */

export const CATEGORY_MODES = ['extend', 'replace'] as const;
export type CategoryMode = (typeof CATEGORY_MODES)[number];

export const CATEGORY_TARGETS = ['message', 'stack', 'step', 'all'] as const;
export type CategoryTarget = (typeof CATEGORY_TARGETS)[number];

export const SCREENSHOT_VIEWS = ['side-by-side', 'slider', 'overlay', 'diff'] as const;
export type ScreenshotView = (typeof SCREENSHOT_VIEWS)[number];

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

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
}
