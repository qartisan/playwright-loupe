import { readFile } from 'node:fs/promises';

// Two levels up from both `src/core` and `dist/core`: the package root.
const PACKAGE_JSON = new URL('../../package.json', import.meta.url);

/** Version of the installed Loupe package, written to `generator.version`. */
export async function generatorVersion(): Promise<string> {
  const { version } = JSON.parse(await readFile(PACKAGE_JSON, 'utf8')) as { version: string };
  return version;
}
