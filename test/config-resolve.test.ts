import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/index.js';
import { CONFIG_FILE_NAMES, findConfigFile, loadConfigFile } from '../src/config/load.js';
import { LoupeConfigError, envLayer, mergeLayers, resolveConfig, stripPlaywrightKeys } from '../src/config/resolve.js';
import { paletteReference } from '../src/shared/palette.js';

const BASE = path.resolve('/project');
const CWD = path.resolve('/project/sub');

const resolve = (layers: { file?: unknown; inline?: Record<string, unknown>; env?: Record<string, string> } = {}) =>
  resolveConfig({
    file: layers.file === undefined ? undefined : { path: path.join(BASE, 'loupe.config.ts'), config: layers.file },
    inline: layers.inline ?? {},
    env: layers.env ?? {},
    baseDir: BASE,
    cwd: CWD,
  });

describe('resolveConfig: defaults', () => {
  it('applies every default without any layer', () => {
    expect(resolve()).toEqual({
      configFile: null,
      outputFolder: path.join(BASE, 'loupe-report'),
      title: 'Loupe report',
      environment: null,
      categories: { mode: 'extend', rules: [], uncategorized: 'Uncategorized' },
      dimensions: { auto: true, definitions: [] },
      screenshots: { defaultView: 'side-by-side' },
      theme: 'system',
      aiPrompt: { includeStack: true },
    });
  });

  it('keeps aiPrompt.includeStack from the config', () => {
    expect(resolve({ file: { aiPrompt: { includeStack: false } } }).aiPrompt).toEqual({ includeStack: false });
  });
});

describe('resolveConfig: precedence is defaults < config file < inline options < environment', () => {
  const file = { title: 'file', environment: 'file-env', outputFolder: 'from-file', theme: 'dark' };

  it('config file over defaults', () => {
    const config = resolve({ file });
    expect([config.title, config.environment, config.outputFolder, config.theme]).toEqual([
      'file',
      'file-env',
      path.join(BASE, 'from-file'),
      'dark',
    ]);
  });

  it('inline options over the config file', () => {
    const config = resolve({ file, inline: { title: 'inline', outputFolder: 'from-inline' } });
    expect([config.title, config.environment, config.outputFolder, config.theme]).toEqual([
      'inline',
      'file-env',
      path.join(BASE, 'from-inline'),
      'dark',
    ]);
  });

  it('environment variables over inline options', () => {
    const config = resolve({
      file,
      inline: { title: 'inline', environment: 'inline-env', outputFolder: 'from-inline' },
      env: { LOUPE_TITLE: 'env', LOUPE_ENV: 'env-env', LOUPE_OUTPUT_FOLDER: 'from-env' },
    });
    // LOUPE_OUTPUT_FOLDER is relative to the working directory.
    expect([config.title, config.environment, config.outputFolder, config.theme]).toEqual([
      'env',
      'env-env',
      path.join(CWD, 'from-env'),
      'dark',
    ]);
  });

  it('ignores empty environment variables', () => {
    expect(envLayer({ LOUPE_TITLE: ' ', LOUPE_ENV: '', LOUPE_OUTPUT_FOLDER: undefined })).toEqual({});
    expect(resolve({ inline: { title: 'inline' }, env: { LOUPE_TITLE: '' } }).title).toBe('inline');
  });

  it('merges nested objects key by key and replaces arrays', () => {
    const config = resolve({
      file: {
        categories: { mode: 'replace', rules: [{ name: 'A', match: /a/ }] },
        dimensions: { auto: false, definitions: [{ name: 'Bug', from: 'annotation', type: 'bug' }] },
      },
      inline: { categories: { rules: [{ name: 'B', match: /b/ }] }, dimensions: { auto: true } },
    });
    expect(config.categories.mode).toBe('replace');
    expect(config.categories.rules.map((rule) => rule.name)).toEqual(['B']);
    expect(config.dimensions).toEqual({
      auto: true,
      definitions: [{ name: 'Bug', from: 'annotation', type: 'bug', values: null }],
    });
  });

  it('lets an inline undefined keep the lower layer', () => {
    expect(resolve({ file: { title: 'file' }, inline: { title: undefined } }).title).toBe('file');
  });
});

describe('resolveConfig: compiled values', () => {
  it('normalizes rules: one list of patterns, default target, stateless patterns', () => {
    const [rule] = resolve({ file: { categories: { rules: [{ name: 'A', match: /a/g }] } } }).categories.rules;
    expect(rule).toEqual({ name: 'A', match: [/a/], on: 'all', color: null });
    // A `g` pattern would alternate between true and false.
    expect([rule?.match[0]?.test('a'), rule?.match[0]?.test('a')]).toEqual([true, true]);
  });

  it('turns a palette color name into its reference color and keeps a #rrggbb color', () => {
    const rules = resolve({
      file: { categories: { rules: [{ name: 'A', match: /a/, color: 'teal' }, { name: 'B', match: /b/, color: '#AbCdEf' }] } },
    }).categories.rules;
    expect(rules.map((rule) => rule.color)).toEqual([paletteReference('teal'), '#AbCdEf']);
  });

  it('keeps expected dimension values', () => {
    const config = resolve({ file: { dimensions: { definitions: [{ name: 'Layer', from: 'tag', prefix: 'layer', values: ['api'] }] } } });
    expect(config.dimensions.definitions).toEqual([{ name: 'Layer', from: 'tag', prefix: 'layer', values: ['api'] }]);
  });
});

describe('resolveConfig: errors', () => {
  it('names the config file in its messages', () => {
    expect(() => resolve({ file: { titel: 'x' } })).toThrow(
      'loupe.config.ts: titel is not a known option. Did you mean "title"?',
    );
  });

  it('names the reporter options in their messages', () => {
    expect(() => resolve({ inline: { theme: 'blue' } })).toThrow(
      'reporter options: theme must be one of "system", "light", "dark", got "blue"',
    );
  });

  it('collects the problems of every layer in one LoupeConfigError', () => {
    let error: unknown;
    try {
      resolve({ file: { title: 1 }, inline: { theme: 'x' } });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(LoupeConfigError);
    expect((error as LoupeConfigError).problems).toHaveLength(2);
    expect((error as Error).message).toMatch(/^Loupe: invalid configuration\.\n {2}- loupe\.config\.ts: title/);
  });

  it('rejects an uncategorized name that a rule also uses, across layers', () => {
    expect(() =>
      resolve({ file: { categories: { uncategorized: 'Other' } }, inline: { categories: { rules: [{ name: 'Other', match: /x/ }] } } }),
    ).toThrow('categories.uncategorized "Other" is also the name of a rule');
  });
});

describe('Playwright keys and layer merging', () => {
  it('removes the keys Playwright adds to reporter options', () => {
    expect(stripPlaywrightKeys({ configDir: '/x', _mode: 'test', _commandHash: '', _isTestServer: false, title: 't' })).toEqual({
      title: 't',
    });
  });

  it('does not merge RegExp or arrays as objects', () => {
    expect(mergeLayers({ a: { b: 1, c: [1] } }, { a: { c: [2] } })).toEqual({ a: { b: 1, c: [2] } });
  });
});

describe('config file lookup and loading', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'loupe-config-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const find = (envPath?: string, optionPath?: string): string | null =>
    findConfigFile({ baseDir: dir, cwd: path.join(dir, 'cwd'), envPath, optionPath });

  it('finds nothing when there is no config file', () => {
    expect(find()).toBeNull();
  });

  it('looks up .ts, then .mts, .js and .mjs', () => {
    expect(CONFIG_FILE_NAMES).toEqual(['loupe.config.ts', 'loupe.config.mts', 'loupe.config.js', 'loupe.config.mjs']);
    for (const name of [...CONFIG_FILE_NAMES].reverse()) {
      writeFileSync(path.join(dir, name), 'export default {};');
      expect(find()).toBe(path.join(dir, name));
    }
  });

  it('uses the configFile option relative to the base dir, and LOUPE_CONFIG relative to the working directory over it', () => {
    mkdirSync(path.join(dir, 'cwd'));
    writeFileSync(path.join(dir, 'loupe.config.ts'), '');
    writeFileSync(path.join(dir, 'option.mjs'), '');
    writeFileSync(path.join(dir, 'cwd', 'env.mjs'), '');
    expect(find(undefined, 'option.mjs')).toBe(path.join(dir, 'option.mjs'));
    expect(find('env.mjs', 'option.mjs')).toBe(path.join(dir, 'cwd', 'env.mjs'));
    expect(find(' ', 'option.mjs')).toBe(path.join(dir, 'option.mjs'));
  });

  it('fails when an explicit config file does not exist', () => {
    expect(() => find('missing.ts')).toThrow(/LOUPE_CONFIG=missing\.ts: config file not found at /);
    expect(() => find(undefined, 'missing.ts')).toThrow(/reporter option configFile: "missing\.ts": config file not found/);
  });

  it('loads the default export of an ES module, and CommonJS exports', () => {
    writeFileSync(path.join(dir, 'esm.mjs'), "export default { title: 'esm', categories: { rules: [{ name: 'A', match: /a/ }] } };");
    writeFileSync(path.join(dir, 'cjs.cjs'), "module.exports = { title: 'cjs' };");
    expect(loadConfigFile(path.join(dir, 'esm.mjs'))).toEqual({ title: 'esm', categories: { rules: [{ name: 'A', match: /a/ }] } });
    expect(loadConfigFile(path.join(dir, 'cjs.cjs'))).toEqual({ title: 'cjs' });
  });

  it('reports a file that cannot be loaded', () => {
    writeFileSync(path.join(dir, 'broken.mjs'), 'export default {');
    expect(() => loadConfigFile(path.join(dir, 'broken.mjs'))).toThrow(/broken\.mjs: cannot be loaded: /);
    writeFileSync(path.join(dir, 'tla.mjs'), 'await Promise.resolve(); export default {};');
    expect(() => loadConfigFile(path.join(dir, 'tla.mjs'))).toThrow(/cannot use top-level await/);
  });

  it('reports a file without default export as an invalid config', () => {
    writeFileSync(path.join(dir, 'loupe.config.mjs'), 'export const title = "x";');
    expect(() => loadConfig({ configDir: dir }, {}, dir)).toThrow(
      'loupe.config.mjs: the config must be an object, got undefined',
    );
  });

  it('loads, validates and merges everything from the reporter options', () => {
    writeFileSync(path.join(dir, 'loupe.config.mjs'), "export default { title: 'file', theme: 'dark' };");
    const config = loadConfig({ configDir: dir, _mode: 'test', title: 'inline' }, { LOUPE_ENV: 'ci' }, dir);
    expect(config).toMatchObject({
      configFile: path.join(dir, 'loupe.config.mjs'),
      title: 'inline',
      theme: 'dark',
      environment: 'ci',
      outputFolder: path.join(dir, 'loupe-report'),
    });
  });

  it('uses the working directory when Playwright gives no configDir', () => {
    expect(loadConfig({}, {}, dir).outputFolder).toBe(path.join(dir, 'loupe-report'));
  });
});
