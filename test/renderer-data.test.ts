import { describe, expect, it } from 'vitest';
import { DEFAULT_RENDERER_SETTINGS } from '../src/core/inject.js';
import { parseReport, parseSettings } from '../src/renderer/data.js';
import { formatDuration } from '../src/renderer/format.js';

describe('parseReport', () => {
  const minimal = { schemaVersion: 1, run: {}, projects: [], tests: [] };

  it('accepts a schema v1 report', () => {
    expect(parseReport(JSON.stringify(minimal))).toEqual({ ok: true, report: minimal });
  });

  it.each([
    [null, /missing or is not valid JSON/],
    ['__LOUPE_DATA__', /missing or is not valid JSON/],
    ['[]', /not a Loupe report/],
    [JSON.stringify({ ...minimal, schemaVersion: 2 }), /Unsupported report schema version 2/],
    [JSON.stringify({ schemaVersion: 1, run: {} }), /incomplete/],
  ])('rejects %j with a message', (text, message) => {
    const result = parseReport(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(message);
  });
});

describe('parseSettings', () => {
  it('falls back to the defaults when the settings are missing or invalid', () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_RENDERER_SETTINGS);
    expect(parseSettings('__LOUPE_SETTINGS__')).toEqual(DEFAULT_RENDERER_SETTINGS);
    expect(parseSettings('"dark"')).toEqual(DEFAULT_RENDERER_SETTINGS);
  });

  it('completes partial settings with the defaults', () => {
    expect(parseSettings(JSON.stringify({ theme: 'dark', screenshots: {} }))).toEqual({ ...DEFAULT_RENDERER_SETTINGS, theme: 'dark' });
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '0 ms'],
    [850, '850 ms'],
    [1000, '1.0 s'],
    [12_345, '12.3 s'],
    [245_000, '4 min 05 s'],
    [3_725_000, '1 h 02 min'],
  ])('formats %d ms as %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});
