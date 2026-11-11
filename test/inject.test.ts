import { describe, expect, it } from 'vitest';
import {
  DATA_PLACEHOLDER,
  DEFAULT_RENDERER_SETTINGS,
  HISTORY_PLACEHOLDER,
  SETTINGS_PLACEHOLDER,
  injectData,
  injectHistory,
  injectSettings,
  serializeForScript,
} from '../src/core/inject.js';

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

/** Returns the raw text of the #loupe-data script, the way an HTML parser would delimit it. */
function extractScriptText(html: string, id = 'loupe-data'): string {
  const open = `<script id="${id}" type="application/json">`;
  const start = html.indexOf(open) + open.length;
  return html.slice(start, html.indexOf('</script>', start));
}

describe('serializeForScript', () => {
  it('cannot close the script element', () => {
    const output = serializeForScript({ title: '</script><script>alert(1)</script>' });
    expect(output).not.toMatch(/<\/script/i);
    expect(output).not.toContain('<');
  });

  it('is case-insensitive safe for the closing tag', () => {
    expect(serializeForScript('</SCRIPT >')).not.toMatch(/<\/script/i);
  });

  it('cannot open an HTML comment', () => {
    // `<!--` inside a script element switches the parser into an escaped state.
    expect(serializeForScript('<!-- <script>')).not.toContain('<!--');
  });

  it('escapes >, & and the line separators', () => {
    const output = serializeForScript(`a > b && c${LS}d${PS}e`);
    expect(output).toBe('"a \\u003e b \\u0026\\u0026 c\\u2028d\\u2029e"');
    expect(output).not.toContain(LS);
    expect(output).not.toContain(PS);
  });

  it('round-trips through JSON.parse', () => {
    const data = {
      title: '</script><!-- & -->',
      lines: [`x${LS}y`, `p${PS}q`],
      nested: { emoji: '🔍', quote: '"', backslash: '\\' },
      count: 3,
      ok: true,
      empty: null,
    };
    expect(JSON.parse(serializeForScript(data))).toEqual(data);
  });

  it('rejects values JSON cannot represent', () => {
    expect(() => serializeForScript(undefined)).toThrow(/not JSON-serializable/);
  });
});

describe('injectData', () => {
  const template = `<!doctype html><html><body>${DATA_PLACEHOLDER}<script type="module">run()</script></body></html>`;

  it('replaces the placeholder with data that parses back unchanged', () => {
    const data = { title: 'evil </script><script>alert(1)</script> <!--' };
    const html = injectData(template, data);

    expect(html).not.toContain('__LOUPE_DATA__');
    expect(JSON.parse(extractScriptText(html))).toEqual(data);
    // The template's own scripts are untouched.
    expect(html).toContain('<script type="module">run()</script></body></html>');
  });

  it('does not interpret $ replacement patterns in the data', () => {
    const data = { title: "$& $' $` $$" };
    expect(JSON.parse(extractScriptText(injectData(template, data)))).toEqual(data);
  });

  it('fails loudly when the placeholder is missing', () => {
    expect(() => injectData('<html></html>', {})).toThrow(/placeholder/);
  });
});

describe('injectSettings', () => {
  const template = `<html><body>${SETTINGS_PLACEHOLDER}${DATA_PLACEHOLDER}</body></html>`;

  it('injects the settings next to the data', () => {
    const settings = { ...DEFAULT_RENDERER_SETTINGS, title: 'Nightly </script>' };
    const html = injectSettings(injectData(template, { tests: [] }), settings);
    expect(JSON.parse(extractScriptText(html, 'loupe-settings'))).toEqual(settings);
    expect(JSON.parse(extractScriptText(html))).toEqual({ tests: [] });
  });

  it('fails loudly when the placeholder is missing', () => {
    expect(() => injectSettings(DATA_PLACEHOLDER, DEFAULT_RENDERER_SETTINGS)).toThrow(/#loupe-settings placeholder/);
  });
});

describe('injectHistory', () => {
  const template = `<html><body>${SETTINGS_PLACEHOLDER}${DATA_PLACEHOLDER}${HISTORY_PLACEHOLDER}</body></html>`;

  it('injects the history, escaped like the data', () => {
    const history = { v: 1, signatures: [['s', null, 'Expected </script> & <b>']] };
    const html = injectHistory(template, history);
    expect(html).not.toContain('__LOUPE_HISTORY__');
    expect(extractScriptText(html, 'loupe-history')).not.toContain('<');
    expect(JSON.parse(extractScriptText(html, 'loupe-history'))).toEqual(history);
  });

  it('writes null when there is no history', () => {
    expect(extractScriptText(injectHistory(template, null), 'loupe-history')).toBe('null');
  });

  it('never throws: a template without the placeholder is returned as is', () => {
    const older = `<html><body>${DATA_PLACEHOLDER}</body></html>`;
    expect(injectHistory(older, { v: 1 })).toBe(older);
  });

  it('never throws: a value that cannot be serialized becomes null', () => {
    expect(extractScriptText(injectHistory(template, { big: 1n }), 'loupe-history')).toBe('null');
    expect(extractScriptText(injectHistory(template, undefined), 'loupe-history')).toBe('null');
  });
});
