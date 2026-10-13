import { existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { LoupeConfigError } from './resolve.js';

/** Looked up in this order in the directory of the Playwright config file. */
export const CONFIG_FILE_NAMES = ['loupe.config.ts', 'loupe.config.mts', 'loupe.config.js', 'loupe.config.mjs'] as const;

export const CONFIG_ENV = 'LOUPE_CONFIG';

const require = createRequire(import.meta.url);

/**
 * Path of the config file to load, or null when there is none.
 *
 * - `LOUPE_CONFIG` (relative to the working directory) wins over the
 *   `configFile` reporter option (relative to the Playwright config's
 *   directory). An explicit file that does not exist is an error.
 * - Otherwise the first of CONFIG_FILE_NAMES found in `baseDir`.
 */
export function findConfigFile(options: {
  baseDir: string;
  cwd: string;
  envPath: string | undefined;
  optionPath: string | undefined;
}): string | null {
  const envPath = options.envPath?.trim();
  const explicit = envPath
    ? { file: path.resolve(options.cwd, envPath), from: `${CONFIG_ENV}=${envPath}` }
    : options.optionPath
      ? { file: path.resolve(options.baseDir, options.optionPath), from: `reporter option configFile: "${options.optionPath}"` }
      : null;
  if (explicit) {
    if (!existsSync(explicit.file) || !statSync(explicit.file).isFile()) {
      throw new LoupeConfigError([`${explicit.from}: config file not found at ${explicit.file}`]);
    }
    return explicit.file;
  }
  for (const name of CONFIG_FILE_NAMES) {
    const file = path.join(options.baseDir, name);
    if (existsSync(file)) return file;
  }
  return null;
}

/**
 * Loads a config file synchronously and returns its default export.
 *
 * Synchronous on purpose: the reporter constructor is the only place where an
 * error stops the run (Playwright does not await `onBegin`). TypeScript works
 * because Playwright has installed its own transform (Babel) before it builds
 * any non-built-in reporter: `require()` of a `.ts` / `.mts` file outside
 * `node_modules` goes through it, in normal runs and in `merge-reports`. ESM
 * output is loaded through Node's `require(esm)` (Node 22.12+), so a config
 * file cannot use top-level `await`. See "How config files are loaded" in
 * docs/config.md.
 */
export function loadConfigFile(file: string): unknown {
  let loaded: unknown;
  try {
    // A long-lived process (watch mode, UI mode) reloads CommonJS output; ES modules stay cached by Node.
    delete require.cache[file];
    loaded = require(file);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const hint =
      code === 'ERR_REQUIRE_ASYNC_MODULE'
        ? ' A Loupe config file cannot use top-level await.'
        : code === 'ERR_REQUIRE_ESM'
          ? ' Loading an ES module config needs Node.js 22.12 or later.'
          : code === 'ERR_UNKNOWN_FILE_EXTENSION'
            ? ' TypeScript config files are loaded through Playwright: use the reporter through `playwright test` or `playwright merge-reports`.'
            : '';
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
    throw new LoupeConfigError([`${path.basename(file)}: cannot be loaded: ${message}.${hint}`]);
  }
  return defaultExport(loaded);
}

/** Unwraps the default export of an ES module namespace or of Babel's CommonJS interop; CommonJS exports are used as is. */
function defaultExport(loaded: unknown): unknown {
  if (loaded !== null && typeof loaded === 'object') {
    const module = loaded as { __esModule?: unknown; default?: unknown; [Symbol.toStringTag]?: unknown };
    if (module.__esModule === true || module[Symbol.toStringTag] === 'Module') return module.default;
  }
  return loaded;
}
