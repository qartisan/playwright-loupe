import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Location } from '@playwright/test/reporter';

/**
 * Node's ESM resolution error, as Playwright reports it for a spec file that
 * imports a missing module or package:
 *   Cannot find module '/abs/tests/missing' imported from /abs/tests/a.spec.ts
 *   Cannot find package 'nope' imported from /abs/tests/a.spec.ts
 */
const ESM_NOT_FOUND = /Cannot find (?:module|package) '([^']+)' imported from (\S+)/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Location of an ESM import failure. For ES module spec files, Playwright
 * reports such load errors at `<anonymous>:1:1`; the importing file is only in
 * the message. Returns that file with the line of the failing import (found by
 * its specifier), or null when the message is not such an error or the import
 * cannot be found in the file. CommonJS spec files already get a precise
 * location and do not need this.
 */
export async function esmImportLocation(message: string): Promise<Location | null> {
  const match = ESM_NOT_FOUND.exec(message);
  if (!match) return null;
  const [, missing = '', importer = ''] = match;
  const file = importer.startsWith('file://') ? fileURLToPath(importer) : importer;
  let source: string;
  try {
    source = await readFile(file, 'utf8');
  } catch {
    return null;
  }
  // The message gives a package name, or the resolved path of a relative import without its extension.
  const name = path.isAbsolute(missing) ? path.basename(missing).replace(/\.[cm]?[jt]sx?$/, '') : missing;
  // './missing', '../lib/missing.js', 'pkg', 'pkg/sub', '@scope/pkg': the quoted specifier ending with the name.
  const specifier = new RegExp(`(['"\`])(?:[^'"\`]*/)?${escapeRegExp(name)}(?:\\.[cm]?[jt]sx?|/[^'"\`]*)?\\1`);
  const lines = source.split(/\r?\n/);
  const index = lines.findIndex((line) => specifier.test(line));
  if (index === -1) return null;
  const line = lines[index] as string;
  return { file, line: index + 1, column: line.length - line.trimStart().length + 1 };
}

/** True when Playwright gave a usable source location (a real file path, not `<anonymous>`). */
export function isUsableLocation(location: Location | undefined): location is Location {
  return location !== undefined && path.isAbsolute(location.file);
}
