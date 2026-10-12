/**
 * Loupe options. Stub: config file loading (`loupe.config.ts`), defaults
 * merging and validation come in a later brief.
 */
export interface LoupeConfig {
  /** Folder the report is written to, relative to the Playwright config file. Default: `loupe-report`. */
  outputFolder?: string;
  /** Report title. Default: `Loupe report`. */
  title?: string;
}

/** Typed identity helper for Loupe options. */
export function defineConfig(config: LoupeConfig): LoupeConfig {
  return config;
}
