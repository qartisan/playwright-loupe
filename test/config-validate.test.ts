import { describe, expect, it } from 'vitest';
import { editDistance, suggestKey, validateConfig } from '../src/config/validate.js';

const SOURCE = 'loupe.config.ts';
const validate = (value: unknown): string[] => validateConfig(value, SOURCE);

describe('validateConfig: valid configs', () => {
  it('accepts an empty config', () => {
    expect(validate({})).toEqual([]);
  });

  it('accepts every option', () => {
    expect(
      validate({
        outputFolder: 'loupe-report',
        title: 'My suite',
        environment: 'preview',
        categories: {
          mode: 'extend',
          rules: [
            { name: 'Infra', match: [/ECONNRESET/, /ECONNREFUSED/], color: '#d97706' },
            { name: 'Auth', match: /session-token/, on: 'message' },
            { name: 'Login', match: /log in/, on: 'step' },
            { name: 'Stack', match: /x/, on: 'stack' },
            { name: 'All', match: /x/, on: 'all' },
          ],
          uncategorized: 'Uncategorized',
        },
        dimensions: {
          auto: true,
          definitions: [
            { name: 'Layer', from: 'tag', prefix: 'layer', values: ['api', 'ui', 'e2e'] },
            { name: 'Bug', from: 'annotation', type: 'bug' },
            { name: 'Owner', from: 'annotation', type: 'owner' },
          ],
        },
        screenshots: { defaultView: 'slider' },
        theme: 'system',
        aiPrompt: { includeStack: false },
        redact: { patterns: ['recovery code', /x-vercel-/i], mode: 'extend', env: ['API_TOKEN', 'E2E_PASSWORD'] },
        git: { local: false },
      }),
    ).toEqual([]);
  });

  it('accepts an empty redact.patterns list (with replace, it turns name-based redaction off)', () => {
    expect(validate({ redact: { mode: 'replace', patterns: [] } })).toEqual([]);
  });

  it('treats options set to undefined as absent', () => {
    expect(validate({ title: undefined, categories: { rules: undefined } })).toEqual([]);
  });

  it('accepts configFile only in reporter options', () => {
    expect(validateConfig({ configFile: 'loupe.ci.ts' }, 'reporter options', { allowConfigFile: true })).toEqual([]);
    expect(validate({ configFile: 'loupe.ci.ts' })).toEqual([
      `${SOURCE}: configFile is not a known option. Known options: outputFolder, title, environment, categories, dimensions, screenshots, theme, aiPrompt, redact, git.`,
    ]);
  });
});

describe('validateConfig: errors name the source, the exact path and the expected type', () => {
  it.each([
    [null, 'the config must be an object, got null'],
    [[], 'the config must be an object, got an array'],
    [{ title: 42 }, 'title must be a non-empty string, got 42'],
    [{ title: '  ' }, 'title must be a non-empty string, got "  "'],
    [{ outputFolder: '' }, 'outputFolder must be a non-empty string, got ""'],
    [{ environment: true }, 'environment must be a non-empty string, got true'],
    [{ theme: 'blue' }, 'theme must be one of "system", "light", "dark", got "blue"'],
    [{ screenshots: { defaultView: 'grid' } }, 'screenshots.defaultView must be one of "side-by-side", "slider", "overlay", "diff", got "grid"'],
    [{ screenshots: 'slider' }, 'screenshots must be an object, got "slider"'],
    [{ aiPrompt: { includeStack: 'no' } }, 'aiPrompt.includeStack must be a boolean, got "no"'],
    [{ aiPrompt: true }, 'aiPrompt must be an object, got true'],
    [{ aiPrompt: { includeStacks: false } }, 'aiPrompt.includeStacks is not a known option. Did you mean "includeStack"?'],
    [{ git: { local: 'false' } }, 'git.local must be a boolean, got "false"'],
    [{ git: false }, 'git must be an object, got false'],
    [{ git: { locale: false } }, 'git.locale is not a known option. Did you mean "local"?'],
    [{ categories: { mode: 'merge' } }, 'categories.mode must be one of "extend", "replace", got "merge"'],
    [{ categories: { rules: {} } }, 'categories.rules must be an array, got an object'],
    [{ categories: { uncategorized: '' } }, 'categories.uncategorized must be a non-empty string, got ""'],
    [{ dimensions: { auto: 'yes' } }, 'dimensions.auto must be a boolean, got "yes"'],
    [{ dimensions: { definitions: 'layer' } }, 'dimensions.definitions must be an array, got "layer"'],
    [{ redact: true }, 'redact must be an object, got true'],
    [{ redact: { mode: 'merge' } }, 'redact.mode must be one of "extend", "replace", got "merge"'],
    [{ redact: { patterns: 'password' } }, 'redact.patterns must be an array of strings or RegExps, got "password"'],
    [{ redact: { patterns: [/a/, ' '] } }, 'redact.patterns[1] must be a non-empty string or a RegExp, got " "'],
    [{ redact: { env: 'API_TOKEN' } }, 'redact.env must be an array of environment variable names, got "API_TOKEN"'],
    [{ redact: { env: [42] } }, 'redact.env[0] must be an environment variable name (letters, digits, _), got 42'],
    [{ redact: { envs: [] } }, 'redact.envs is not a known option. Did you mean "env"?'],
  ])('%j', (config, message) => {
    expect(validate(config)).toEqual([`${SOURCE}: ${message}`]);
  });

  it('reports a redact.patterns item that is neither a string nor a RegExp, with its index', () => {
    expect(validate({ redact: { patterns: [/a/, 'b', 3] } })).toEqual([`${SOURCE}: redact.patterns[2] must be a non-empty string or a RegExp, got 3`]);
  });

  it('rejects a redact.env item that is not a variable name without echoing it, and repeated names', () => {
    const errors = validate({ redact: { env: ['API_TOKEN', 'Inv3nted secret!', 'API_TOKEN'] } });
    expect(errors).toEqual([
      `${SOURCE}: redact.env[1] must be an environment variable name (letters, digits, _), got a string that is not a variable name (value not shown)`,
      `${SOURCE}: redact.env[2] repeats the variable API_TOKEN`,
    ]);
    expect(errors.join('\n')).not.toContain('Inv3nted');
  });

  it('reports a wrong match with its index', () => {
    const rules = [
      { name: 'A', match: /a/ },
      { name: 'B', match: [/b/] },
      { name: 'C', match: 'ECONN' },
    ];
    expect(validate({ categories: { rules } })).toEqual([
      `${SOURCE}: categories.rules[2].match must be a RegExp or an array of RegExp, got "ECONN"`,
    ]);
  });

  it('reports a wrong pattern inside a match list, and an empty list', () => {
    expect(validate({ categories: { rules: [{ name: 'A', match: [/a/, 'b'] }] } })).toEqual([
      `${SOURCE}: categories.rules[0].match[1] must be a RegExp, got "b"`,
    ]);
    expect(validate({ categories: { rules: [{ name: 'A', match: [] }] } })).toEqual([
      `${SOURCE}: categories.rules[0].match must be a RegExp or an array of RegExp (not empty), got an array`,
    ]);
  });

  it('checks the rule fields', () => {
    expect(validate({ categories: { rules: [{ match: /a/, on: 'title', color: 'red' }] } })).toEqual([
      `${SOURCE}: categories.rules[0].on must be one of "message", "stack", "step", "all", got "title"`,
      `${SOURCE}: categories.rules[0].color must be a #rrggbb color or a palette color ("blue", "cyan", "teal", "violet", "magenta", "orange", "brown", "gold"), got "red"`,
      `${SOURCE}: categories.rules[0].name is required`,
    ]);
  });

  it('accepts a palette color name and rejects an unknown one, listing the valid names', () => {
    expect(validate({ categories: { rules: [{ name: 'A', match: /a/, color: 'teal' }] } })).toEqual([]);
    expect(validate({ categories: { rules: [{ name: 'A', match: /a/, color: 'tael' }] } })).toEqual([
      `${SOURCE}: categories.rules[0].color must be a #rrggbb color or a palette color ("blue", "cyan", "teal", "violet", "magenta", "orange", "brown", "gold"), got "tael". Did you mean "teal"?`,
    ]);
    // Names are lowercase, like the CSS color keywords they look like.
    expect(validate({ categories: { rules: [{ name: 'A', match: /a/, color: 'Teal' }] } })).toEqual([
      `${SOURCE}: categories.rules[0].color must be a #rrggbb color or a palette color ("blue", "cyan", "teal", "violet", "magenta", "orange", "brown", "gold"), got "Teal". Did you mean "teal"?`,
    ]);
    expect(validate({ categories: { rules: [{ name: 'A', match: /a/, color: '#12345' }] } })).toEqual([
      `${SOURCE}: categories.rules[0].color must be a #rrggbb color or a palette color ("blue", "cyan", "teal", "violet", "magenta", "orange", "brown", "gold"), got "#12345"`,
    ]);
  });

  it('checks dimension definitions by source', () => {
    expect(
      validate({
        dimensions: {
          definitions: [
            { name: 'Layer', from: 'tag' },
            { name: 'Bug', from: 'annotation', type: 'bug', values: ['A', 'A', ''] },
            { name: 'X', from: 'label', key: 'x' },
            { name: 'Area', from: 'tag', prefix: '@area' },
            'owner',
          ],
        },
      }),
    ).toEqual([
      `${SOURCE}: dimensions.definitions[0].prefix is required when from is "tag"`,
      `${SOURCE}: dimensions.definitions[1].values[1] repeats the value "A"`,
      `${SOURCE}: dimensions.definitions[1].values[2] must be a non-empty string, got ""`,
      `${SOURCE}: dimensions.definitions[2].from must be "tag" or "annotation", got "label"`,
      `${SOURCE}: dimensions.definitions[3].prefix must be a tag prefix without '@', ':' or spaces ("layer" for @layer:api), got "@area"`,
      `${SOURCE}: dimensions.definitions[4] must be an object, got "owner"`,
    ]);
  });

  it('rejects keys of the other dimension source', () => {
    expect(validate({ dimensions: { definitions: [{ name: 'Layer', from: 'tag', prefix: 'layer', type: 'x' }] } })).toEqual([
      `${SOURCE}: dimensions.definitions[0].type is not a known option. Known options: name, from, prefix, values.`,
    ]);
  });

  it('rejects duplicate dimension names, prefixes and annotation types', () => {
    expect(
      validate({
        dimensions: {
          definitions: [
            { name: 'Layer', from: 'tag', prefix: 'layer' },
            { name: 'Layer', from: 'annotation', type: 'layer' },
            { name: 'Tier', from: 'tag', prefix: 'layer' },
            { name: 'Bug', from: 'annotation', type: 'layer' },
          ],
        },
      }),
    ).toEqual([
      `${SOURCE}: dimensions.definitions[1].name "Layer" is already used by dimensions.definitions[0]`,
      `${SOURCE}: dimensions.definitions[2].prefix "layer" is already used by dimensions.definitions[0]`,
      `${SOURCE}: dimensions.definitions[3].type "layer" is already used by dimensions.definitions[1]`,
    ]);
  });

  it('reports every problem at once', () => {
    expect(validate({ title: 1, theme: 'x', categories: { mode: 'y' } })).toHaveLength(3);
  });
});

describe('validateConfig: unknown keys', () => {
  it.each([
    [{ titel: 'x' }, 'titel is not a known option. Did you mean "title"?'],
    [{ outputFolde: 'x' }, 'outputFolde is not a known option. Did you mean "outputFolder"?'],
    [{ OutputFolder: 'x' }, 'OutputFolder is not a known option. Did you mean "outputFolder"?'],
    [{ categories: { rulez: [] } }, 'categories.rulez is not a known option. Did you mean "rules"?'],
    [{ categories: { rules: [{ name: 'A', match: /a/, colour: '#000000' }] } }, 'categories.rules[0].colour is not a known option. Did you mean "color"?'],
    [{ dimensions: { definitons: [] } }, 'dimensions.definitons is not a known option. Did you mean "definitions"?'],
    [{ screenshots: { defaultview: 'diff' } }, 'screenshots.defaultview is not a known option. Did you mean "defaultView"?'],
  ])('%j', (config, message) => {
    expect(validate(config)).toEqual([`${SOURCE}: ${message}`]);
  });

  it('lists the known options when nothing is close', () => {
    expect(validate({ history: {} })).toEqual([
      `${SOURCE}: history is not a known option. Known options: outputFolder, title, environment, categories, dimensions, screenshots, theme, aiPrompt, redact, git.`,
    ]);
  });
});

describe('suggestKey', () => {
  it('counts a transposition as one edit', () => {
    expect(editDistance('titel', 'title')).toBe(1);
    expect(editDistance('theme', 'theme')).toBe(0);
    expect(editDistance('', 'abc')).toBe(3);
  });

  it('suggests nothing for distant keys', () => {
    expect(suggestKey('xyz', ['title', 'theme'])).toBeNull();
    expect(suggestKey('logo', ['title', 'theme'])).toBeNull();
  });
});
