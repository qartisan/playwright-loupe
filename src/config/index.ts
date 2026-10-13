import { CONFIG_ENV, findConfigFile, loadConfigFile } from './load.js';
import { resolveConfig, stripPlaywrightKeys } from './resolve.js';
import type { ResolvedConfig } from './types.js';

export type * from './types.js';
export { defineConfig } from './define.js';
export { LoupeConfigError } from './resolve.js';

/**
 * Finds, loads, validates and merges the Loupe config for a reporter instance.
 * `options` are the raw reporter options, including the keys Playwright adds:
 * `configDir` is the directory of the Playwright config file (of the merge
 * config under `merge-reports`, the working directory when there is none).
 */
export function loadConfig(
  options: Record<string, unknown>,
  env: Readonly<Record<string, string | undefined>> = process.env,
  cwd: string = process.cwd(),
): ResolvedConfig {
  const baseDir = typeof options['configDir'] === 'string' ? options['configDir'] : cwd;
  const inline = stripPlaywrightKeys(options);
  const optionPath = typeof inline['configFile'] === 'string' ? inline['configFile'] : undefined;
  const file = findConfigFile({ baseDir, cwd, envPath: env[CONFIG_ENV], optionPath });
  return resolveConfig({
    file: file ? { path: file, config: loadConfigFile(file) } : undefined,
    inline,
    env,
    baseDir,
    cwd,
  });
}
