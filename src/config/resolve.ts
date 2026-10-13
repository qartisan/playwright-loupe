import path from 'node:path';
import type { LoupeConfig, LoupeReporterOptions, ResolvedCategoryRule, ResolvedConfig, ResolvedDimension } from './types.js';
import { validateConfig } from './validate.js';

type Env = Readonly<Record<string, string | undefined>>;

export const DEFAULT_OUTPUT_FOLDER = 'loupe-report';
export const DEFAULT_TITLE = 'Loupe report';
export const DEFAULT_UNCATEGORIZED = 'Uncategorized';

/** Environment variables mapped onto config options. `LOUPE_CONFIG` and `LOUPE_RUN_SCOPE` are handled apart. */
export const ENV_OPTIONS = {
  LOUPE_OUTPUT_FOLDER: 'outputFolder',
  LOUPE_TITLE: 'title',
  LOUPE_ENV: 'environment',
} as const satisfies Record<string, keyof LoupeConfig>;

/** Thrown for any invalid configuration; the message lists every problem. */
export class LoupeConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Loupe: invalid configuration.\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    this.name = 'LoupeConfigError';
  }
}

/**
 * Playwright adds its own keys to every reporter's options: `configDir`, and
 * internal ones starting with `_` (`_mode`, `_commandHash`, `_isTestServer`).
 * They are not Loupe options and are removed before validation.
 */
export function stripPlaywrightKeys(options: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(options).filter(([key]) => key !== 'configDir' && !key.startsWith('_')));
}

/** Non-empty value of an environment variable, trimmed; undefined otherwise. */
function envValue(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

/** The environment layer: options set through `LOUPE_*` variables. Empty variables are ignored. */
export function envLayer(env: Env): LoupeConfig {
  const layer: LoupeConfig = {};
  for (const [variable, option] of Object.entries(ENV_OPTIONS)) {
    const value = envValue(env, variable);
    if (value !== undefined) layer[option] = value;
  }
  return layer;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof RegExp);
}

/**
 * Merges `layer` over `base`: nested objects (`categories`, `dimensions`,
 * `screenshots`) merge key by key; arrays and other values replace. An
 * `undefined` value leaves the base untouched.
 */
export function mergeLayers<T extends object>(base: T, layer: object): T {
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(layer)) {
    if (value === undefined) continue;
    const current = result[key];
    result[key] = isObject(current) && isObject(value) ? mergeLayers<object>(current, value) : value;
  }
  return result as T;
}

/** Copies a pattern without the stateful `g` and `y` flags, so `test()` gives the same answer every time. */
function stateless(pattern: RegExp): RegExp {
  return pattern.global || pattern.sticky ? new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, '')) : pattern;
}

function resolveRules(config: LoupeConfig): ResolvedCategoryRule[] {
  return (config.categories?.rules ?? []).map((rule) => ({
    name: rule.name,
    match: (Array.isArray(rule.match) ? rule.match : [rule.match]).map(stateless),
    on: rule.on ?? 'all',
    color: rule.color ?? null,
  }));
}

function resolveDimensions(config: LoupeConfig): ResolvedDimension[] {
  return (config.dimensions?.definitions ?? []).map((definition) =>
    definition.from === 'tag'
      ? { name: definition.name, from: 'tag', prefix: definition.prefix, values: definition.values ? [...definition.values] : null }
      : { name: definition.name, from: 'annotation', type: definition.type, values: definition.values ? [...definition.values] : null },
  );
}

export interface ConfigLayers {
  /** Contents of the config file, unvalidated; undefined when there is none. */
  file?: { path: string; config: unknown } | undefined;
  /** Inline reporter options, Playwright's own keys already removed. */
  inline: Record<string, unknown>;
  env: Env;
  /** Directory relative options are resolved from: the Playwright config's directory. */
  baseDir: string;
  cwd: string;
}

/**
 * Validates each layer, then merges them: defaults < config file < inline
 * options < environment variables. Throws a LoupeConfigError listing every
 * problem of every layer.
 */
export function resolveConfig(layers: ConfigLayers): ResolvedConfig {
  const fileSource = layers.file ? path.basename(layers.file.path) : '';
  const env = envLayer(layers.env);
  const problems = [
    ...(layers.file ? validateConfig(layers.file.config, fileSource) : []),
    ...validateConfig(layers.inline, 'reporter options', { allowConfigFile: true }),
  ];
  if (problems.length > 0) throw new LoupeConfigError(problems);

  const { configFile: _configFile, ...inline } = layers.inline as LoupeReporterOptions;
  const merged = mergeLayers(mergeLayers((layers.file?.config ?? {}) as LoupeConfig, inline), env);

  const uncategorized = merged.categories?.uncategorized ?? DEFAULT_UNCATEGORIZED;
  const rules = resolveRules(merged);
  if (rules.some((rule) => rule.name === uncategorized)) {
    throw new LoupeConfigError([
      `merged config: categories.uncategorized "${uncategorized}" is also the name of a rule; use a name no rule uses`,
    ]);
  }

  // LOUPE_OUTPUT_FOLDER is relative to the working directory, like Playwright's own *_OUTPUT_DIR variables.
  const outputFolder =
    env.outputFolder !== undefined
      ? path.resolve(layers.cwd, env.outputFolder)
      : path.resolve(layers.baseDir, merged.outputFolder ?? DEFAULT_OUTPUT_FOLDER);

  return {
    configFile: layers.file?.path ?? null,
    outputFolder,
    title: merged.title ?? DEFAULT_TITLE,
    environment: merged.environment ?? null,
    categories: { mode: merged.categories?.mode ?? 'extend', rules, uncategorized },
    dimensions: { auto: merged.dimensions?.auto ?? true, definitions: resolveDimensions(merged) },
    screenshots: { defaultView: merged.screenshots?.defaultView ?? 'side-by-side' },
    theme: merged.theme ?? 'system',
  };
}
