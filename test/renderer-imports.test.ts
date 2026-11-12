import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './helpers/fixtures.js';

/**
 * The renderer never imports src/core, directly or through another module
 * (src/shared, src/schema): it is built into a standalone page, and the core
 * is Node code. Type-only imports count too: the rule is about where code
 * belongs, not only about what the bundle keeps.
 */

const RENDERER = path.join(ROOT, 'src/renderer');
const CORE = path.join(ROOT, 'src/core');

/** Every import, export-from and dynamic import specifier of a file, type-only ones included. */
export function specifiers(source: string): string[] {
  const found: string[] = [];
  const patterns = [/\b(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g, /\bimport\s*['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g];
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) found.push(match[1] as string);
  return found;
}

/** The source file a relative specifier points to (`./a.js` is `./a.ts` or `./a.tsx`); null for a package or an asset. */
function resolve(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const target = path.resolve(path.dirname(from), specifier);
  const base = target.replace(/\.(js|jsx|mjs)$/, '');
  for (const candidate of [target, `${base}.ts`, `${base}.tsx`, path.join(target, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile() && /\.tsx?$/.test(candidate)) return candidate;
  }
  return null;
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** Every chain from a renderer file to a file of src/core, as `a.ts → b.ts → core/c.ts`. */
function coreChains(): string[] {
  const chains: string[] = [];
  const seen = new Set<string>();
  const queue = sources(RENDERER).map((file) => [file]);
  while (queue.length > 0) {
    const chain = queue.shift() as string[];
    const file = chain[chain.length - 1] as string;
    if (file.startsWith(`${CORE}${path.sep}`)) {
      chains.push(chain.map((step) => path.relative(ROOT, step)).join(' → '));
      continue;
    }
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of specifiers(readFileSync(file, 'utf8'))) {
      const target = resolve(file, specifier);
      if (target !== null) queue.push([...chain, target]);
    }
  }
  return chains;
}

describe('the renderer never imports src/core', () => {
  it('no renderer file reaches src/core, directly or through another module', () => {
    expect(coreChains()).toEqual([]);
  });

  it('reads every kind of import, type-only and multi-line ones included', () => {
    const source = [
      "import { a } from '../core/a.js';",
      "import type { B } from '../core/b.js';",
      'import {\n  c,\n  type D,\n} from "../core/c.js";',
      "export { e } from '../core/e.js';",
      "export type { F } from '../core/f.js';",
      "import '../core/g.js';",
      "const h = await import('../core/h.js');",
    ].join('\n');
    expect(specifiers(source)).toEqual(expect.arrayContaining(['../core/a.js', '../core/b.js', '../core/c.js', '../core/e.js', '../core/f.js', '../core/g.js', '../core/h.js']));
    expect(specifiers(source)).toHaveLength(7);
  });
});
