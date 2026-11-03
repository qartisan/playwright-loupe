import { readFileSync } from 'node:fs';
import { chmod, copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { MIN_PLAYWRIGHT_TRACE_VIEWER, SUPPORT_URL, isBelow, parseMinorVersion } from './support.js';

/** Folder, inside the report folder, that holds the copied trace viewer. Removed on every run. */
export const TRACE_VIEWER_FOLDER = 'trace-viewer';

/** Where `playwright-core` keeps its trace viewer: an internal location, the same from 1.52 to at least 1.64. */
const VIEWER_LOCATION = ['lib', 'vite', 'traceViewer'];

const require = createRequire(import.meta.url);

export interface PlaywrightCore {
  /** Folder of the package. */
  root: string;
  /** The `version` of its `package.json`, as read. */
  version: unknown;
}

/** The package whose `package.json` is `file`, null unless it can be read and is `playwright-core`. */
function readCore(file: string): PlaywrightCore | null {
  try {
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as { name?: unknown; version?: unknown } | null;
    return manifest?.name === 'playwright-core' ? { root: path.dirname(file), version: manifest.version } : null;
  } catch {
    return null;
  }
}

/** The `playwright-core` among already loaded modules: the Playwright of this very process. */
function loadedCore(moduleFiles: readonly string[]): PlaywrightCore | null {
  const roots = new Set<string>();
  for (const file of moduleFiles) {
    const root = /^(.*[\\/]playwright-core)[\\/]/.exec(file)?.[1];
    if (root) roots.add(root);
  }
  for (const root of roots) {
    const core = readCore(path.join(root, 'package.json'));
    if (core) return core;
  }
  return null;
}

/** `playwright-core` through its dependents, each resolved from the previous one: strict layouts (pnpm) hide it from the project. */
function chainedCore(fromDir: string): PlaywrightCore | null {
  try {
    const test = createRequire(path.join(fromDir, 'noop.js')).resolve('@playwright/test/package.json');
    const playwright = createRequire(test).resolve('playwright/package.json');
    return readCore(createRequire(playwright).resolve('playwright-core/package.json'));
  } catch {
    return null;
  }
}

/**
 * The project's own `playwright-core`, never one found from Loupe's location:
 * in a monorepo, that can be another version. Null when it cannot be found.
 *
 * @param fromDir directory of the Playwright config
 * @param moduleFiles files of the loaded CommonJS modules
 */
export function findPlaywrightCore(fromDir: string, moduleFiles: readonly string[] = Object.keys(require.cache)): PlaywrightCore | null {
  return loadedCore(moduleFiles) ?? chainedCore(fromDir);
}

/** Copies a folder, every file writable: Playwright's own can be read-only (a Nix store), and the next run removes the copy. */
async function copyFolder(source: string, target: string): Promise<void> {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await copyFolder(from, to);
    } else {
      await copyFile(from, to);
      await chmod(to, 0o644);
    }
  }
}

export interface BundleOptions {
  /** Absolute report folder. */
  outputFolder: string;
  /** The result of `findPlaywrightCore`. */
  core: PlaywrightCore | null;
  /** Under `merge-reports`, the Playwright version of the blobs as the reporter sees it: `config.version`. Null otherwise. */
  blobVersion: string | null;
}

export interface BundleResult {
  copied: boolean;
  /** The one line to write on stderr. */
  warning: string | null;
}

const WITHOUT_VIEWER = 'The report is written without the trace viewer.';

/**
 * Copies the trace viewer of the project's Playwright into the report folder.
 * Never throws: whatever goes wrong, the report is written without the viewer,
 * with one warning. The version judged is the viewer's, read from its own
 * package: `config.version` is the blobs' version under `merge-reports`.
 */
export async function bundleTraceViewer(options: BundleOptions): Promise<BundleResult> {
  const target = path.join(options.outputFolder, TRACE_VIEWER_FOLDER);
  try {
    const { core, blobVersion } = options;
    if (!core) return { copied: false, warning: `Loupe: traceViewer "bundled": playwright-core was not found. ${WITHOUT_VIEWER}` };

    const { version } = core;
    if (!parseMinorVersion(version) || isBelow(version, MIN_PLAYWRIGHT_TRACE_VIEWER)) {
      const found = parseMinorVersion(version) ? `this is ${String(version)}` : 'its version cannot be read';
      return {
        copied: false,
        warning: `Loupe: traceViewer "bundled" needs Playwright ${MIN_PLAYWRIGHT_TRACE_VIEWER} or later; ${found}. ${WITHOUT_VIEWER} See ${SUPPORT_URL}`,
      };
    }

    const source = path.join(core.root, ...VIEWER_LOCATION);
    try {
      await stat(path.join(source, 'index.html'));
    } catch {
      return {
        copied: false,
        warning: `Loupe: traceViewer "bundled": Playwright ${String(version)} has no trace viewer at ${VIEWER_LOCATION.join('/')}. ${WITHOUT_VIEWER} See ${SUPPORT_URL}`,
      };
    }

    await copyFolder(source, target);
    return {
      copied: true,
      warning: blobVersion !== null && isBelow(version, blobVersion)
        ? `Loupe: merge-reports runs Playwright ${String(version)}, older than the ${blobVersion} of the blob reports. Traces from newer versions may not open in the bundled trace viewer.`
        : null,
    };
  } catch (error) {
    await rm(target, { recursive: true, force: true }).catch(() => {});
    const reason = (error as NodeJS.ErrnoException | null)?.code ?? (error instanceof Error ? error.name : 'unknown error');
    return { copied: false, warning: `Loupe: traceViewer "bundled": the copy failed (${reason}). ${WITHOUT_VIEWER}` };
  }
}
