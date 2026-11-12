/** Placeholder the renderer template carries where the report data goes. */
export const DATA_PLACEHOLDER = '<script id="loupe-data" type="application/json">__LOUPE_DATA__</script>';

/** Placeholder for the renderer settings, which are not part of the report data contract. */
export const SETTINGS_PLACEHOLDER = '<script id="loupe-settings" type="application/json">__LOUPE_SETTINGS__</script>';

/** Placeholder for the embedded history (`EmbeddedHistory` or null), outside the report data contract. */
export const HISTORY_PLACEHOLDER = '<script id="loupe-history" type="application/json">__LOUPE_HISTORY__</script>';

import type { RendererSettings } from '../shared/settings.js';

// The settings live in src/shared, read by the renderer too; re-exported for the core and its callers.
export { DEFAULT_RENDERER_SETTINGS, type RendererSettings } from '../shared/settings.js';

const UNSAFE_CHARS: Record<string, string> = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

/**
 * Serializes a value to JSON that can be embedded verbatim inside a
 * `<script type="application/json">` element.
 *
 * `<`, `>` and `&` only ever appear inside JSON string literals, so replacing
 * them with their `\uXXXX` escapes keeps the JSON equivalent while making
 * `</script>` and `<!--` impossible. U+2028/U+2029 are escaped too so the
 * payload stays safe if it is ever evaluated as JavaScript.
 */
export function serializeForScript(value: unknown): string {
  const json = JSON.stringify(value) as string | undefined;
  if (json === undefined) {
    throw new TypeError('Loupe: report data is not JSON-serializable');
  }
  return json.replace(/[<>&\u2028\u2029]/g, (char) => UNSAFE_CHARS[char] ?? char);
}

function injectScript(template: string, placeholder: string, id: string, value: unknown): string {
  const index = template.indexOf(placeholder);
  if (index === -1) {
    throw new Error(`Loupe: renderer template does not contain the #${id} placeholder`);
  }
  const script = `<script id="${id}" type="application/json">${serializeForScript(value)}</script>`;
  // Slicing instead of String#replace avoids `$&`-style substitution patterns in the data.
  return template.slice(0, index) + script + template.slice(index + placeholder.length);
}

/** Replaces the data placeholder in the renderer template with the serialized report. */
export function injectData(template: string, data: unknown): string {
  return injectScript(template, DATA_PLACEHOLDER, 'loupe-data', data);
}

/** Replaces the settings placeholder in the renderer template with the serialized settings. */
export function injectSettings(template: string, settings: RendererSettings): string {
  return injectScript(template, SETTINGS_PLACEHOLDER, 'loupe-settings', settings);
}

/**
 * Replaces the history placeholder with the embedded history, `null` when
 * there is none. Never throws: history must not prevent the report. A
 * template without the placeholder (an older renderer) is returned as is,
 * and a value that cannot be serialized is written as `null`.
 */
export function injectHistory(template: string, history: unknown): string {
  const index = template.indexOf(HISTORY_PLACEHOLDER);
  if (index === -1) return template;
  let json: string;
  try {
    json = serializeForScript(history);
  } catch {
    json = 'null';
  }
  const script = `<script id="loupe-history" type="application/json">${json}</script>`;
  return template.slice(0, index) + script + template.slice(index + HISTORY_PLACEHOLDER.length);
}
