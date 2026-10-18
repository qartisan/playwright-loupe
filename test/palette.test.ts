import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { categoryColors } from '../src/renderer/categoryColors.js';
import {
  SURFACES,
  TEXT_CONTRAST,
  UI_CONTRAST,
  contrast,
  deltaE2000,
  deriveTriplet,
  toHex,
  toLab,
  tripletProblems,
  type ThemeName,
  type Triplet,
} from '../src/shared/color.js';
import { NEUTRAL_ENTRY, PALETTE_ENTRIES, PALETTE_NAMES, paletteEntryByReference, paletteReference } from '../src/shared/palette.js';
import { ROOT } from './helpers/fixtures.js';

/** Accessibility of the renderer's colors: WCAG contrast in both themes, and category hues that never look alike. */

const CSS = readFileSync(path.join(ROOT, 'src/renderer/styles.css'), 'utf8');
const THEMES: readonly ThemeName[] = ['light', 'dark'];

/** Custom properties declared directly in the first block whose selector matches. */
function tokens(selector: RegExp): Record<string, string> {
  const match = selector.exec(CSS);
  if (!match) throw new Error(`no ${String(selector)} block in styles.css`);
  const body = CSS.slice(match.index + match[0].length, CSS.indexOf('}', match.index));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map(([, name, value]) => [name, (value as string).toLowerCase()]));
}

const TOKENS: Record<ThemeName, Record<string, string>> = {
  light: tokens(/^:root \{/m),
  dark: tokens(/^:root\[data-theme='dark'\] \{/m),
};

function token(theme: ThemeName, name: string): string {
  const value = TOKENS[theme][name];
  if (!value) throw new Error(`${name} is not defined for the ${theme} theme`);
  return value;
}

const BACKGROUNDS = ['--bg', '--bg-card', '--bg-muted'];
const TEXT_TOKENS = ['--fg', '--fg-secondary', '--status-passed', '--status-failed', '--status-flaky', '--status-skipped', '--diff-expected', '--diff-received'];

/** CIELAB hue angle in degrees. */
function hue(hex: string): number {
  const [, a, b] = toLab(hex);
  return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
}

function categoryTriplets(theme: ThemeName): Array<[string, Triplet]> {
  return [...PALETTE_ENTRIES, NEUTRAL_ENTRY].map((entry) => [entry.name, entry[theme]]);
}

describe('design tokens', () => {
  it('match the brand values', () => {
    expect(TOKENS.light).toMatchObject({
      '--bg': '#f7f5f0',
      '--bg-card': '#ffffff',
      '--bg-muted': '#eeeae2',
      '--fg': '#111111',
      '--fg-secondary': '#666666',
      '--border': '#e8e4dc',
      '--border-control': '#8a857c',
      '--status-passed': '#3e6e51',
      '--status-failed': '#b3261e',
      '--status-flaky': '#6b4a05',
      '--status-flaky-bg': '#fbf0d9',
      '--status-skipped': '#666666',
      '--diff-expected': '#1f6b3a',
      '--diff-received': '#b3261e',
    });
    expect(TOKENS.dark).toMatchObject({
      '--bg': '#080808',
      '--bg-card': '#0d0d0d',
      '--bg-muted': '#161616',
      '--fg': '#f0ede8',
      '--fg-secondary': '#8a8a8a',
      '--border': '#262626',
      '--border-control': '#6b6b6b',
      '--status-passed': '#7da88a',
      '--status-failed': '#f28b82',
      '--status-flaky': '#f0cf8a',
      '--status-flaky-bg': '#1f1705',
      '--status-skipped': '#8a8a8a',
      '--diff-expected': '#7fc79a',
      '--diff-received': '#f28b82',
    });
  });

  it('are the same for the system dark theme and the explicit one', () => {
    expect(tokens(/:root:not\(\[data-theme='light'\]\) \{/)).toEqual(TOKENS.dark);
  });

  it('are the surfaces category colors are checked against', () => {
    for (const theme of THEMES) expect(BACKGROUNDS.map((name) => token(theme, name))).toEqual(SURFACES[theme]);
  });
});

describe.each(THEMES)('contrast, %s theme', (theme) => {
  it.each(TEXT_TOKENS.flatMap((text) => BACKGROUNDS.map((background) => [text, background])))(
    `text %s on %s is at least ${TEXT_CONTRAST}:1`,
    (text, background) => {
      expect(contrast(token(theme, text), token(theme, background))).toBeGreaterThanOrEqual(TEXT_CONTRAST);
    },
  );

  it(`flaky badge text on its background is at least ${TEXT_CONTRAST}:1`, () => {
    expect(contrast(token(theme, '--status-flaky'), token(theme, '--status-flaky-bg'))).toBeGreaterThanOrEqual(TEXT_CONTRAST);
  });

  it.each(BACKGROUNDS)(`control borders and status icons on %s are at least ${UI_CONTRAST}:1`, (background) => {
    for (const name of ['--border-control', '--status-passed', '--status-failed', '--status-flaky', '--status-skipped']) {
      expect(contrast(token(theme, name), token(theme, background)), name).toBeGreaterThanOrEqual(UI_CONTRAST);
    }
  });

  it.each(categoryTriplets(theme))(
    `category %s: text ${TEXT_CONTRAST}:1 on its background, border ${UI_CONTRAST}:1 on its background and the page surfaces`,
    (_name, triplet) => {
      expect(tripletProblems(triplet, theme)).toEqual([]);
    },
  );
});

describe('category palette', () => {
  const MIN_DISTANCE = 15;

  it('has eight hues with unique names and reference colors', () => {
    expect(PALETTE_ENTRIES).toHaveLength(8);
    expect(new Set(PALETTE_NAMES).size).toBe(PALETTE_NAMES.length);
    const references = [...PALETTE_ENTRIES, NEUTRAL_ENTRY].map((entry) => entry.reference);
    expect(new Set(references).size).toBe(references.length);
    for (const reference of references) expect(reference).toMatch(/^#[0-9a-f]{6}$/);
  });

  it.each(THEMES)(`never has two categories (neutral included) closer than ΔE2000 ${MIN_DISTANCE}, %s theme`, (theme) => {
    const entries = categoryTriplets(theme);
    const close: string[] = [];
    for (const [i, [nameA, a]] of entries.entries()) {
      for (const [nameB, b] of entries.slice(i + 1)) {
        for (const part of ['border', 'text'] as const) {
          const distance = deltaE2000(a[part], b[part]);
          if (distance < MIN_DISTANCE) close.push(`${nameA}/${nameB} ${part}: ${distance.toFixed(1)}`);
        }
      }
    }
    expect(close).toEqual([]);
  });

  it.each(THEMES)('has no red or green hue, so a category never reads as a status, %s theme', (theme) => {
    const failed = token(theme, '--status-failed');
    const passed = token(theme, '--status-passed');
    for (const entry of PALETTE_ENTRIES) {
      for (const color of [entry[theme].text, entry[theme].border]) {
        const angle = hue(color);
        // CIELAB hues: reds around 20–45°, greens around 120–165°.
        expect(angle < 10 || angle > 50, `${entry.name} ${color} hue ${angle.toFixed(0)}° is red`).toBe(true);
        expect(angle < 100 || angle > 175, `${entry.name} ${color} hue ${angle.toFixed(0)}° is green`).toBe(true);
        expect(deltaE2000(color, failed), `${entry.name} ${color} vs failed`).toBeGreaterThanOrEqual(10);
        expect(deltaE2000(color, passed), `${entry.name} ${color} vs passed`).toBeGreaterThanOrEqual(10);
      }
    }
  });

  it('has a neutral grey for the uncategorized bucket', () => {
    for (const theme of THEMES) {
      for (const color of Object.values(NEUTRAL_ENTRY[theme])) {
        const [, a, b] = toLab(color);
        expect(Math.hypot(a, b), color).toBeLessThan(2);
      }
    }
  });

  it('maps names to reference colors and back', () => {
    for (const entry of PALETTE_ENTRIES) {
      expect(paletteReference(entry.name)).toBe(entry.reference);
      expect(paletteEntryByReference(entry.reference.toUpperCase())).toBe(entry);
    }
    expect(paletteEntryByReference('#123456')).toBeNull();
    expect(() => paletteReference('red')).toThrow(/unknown palette color "red"; known colors: blue, cyan/);
  });
});

describe('category colors in the renderer', () => {
  it('use the hand-tuned triplets for a palette reference color', () => {
    for (const entry of [...PALETTE_ENTRIES, NEUTRAL_ENTRY]) {
      expect(categoryColors(entry.reference)).toEqual({ light: entry.light, dark: entry.dark });
    }
  });

  it('fall back to the neutral triplets for a missing or invalid color', () => {
    expect(categoryColors(undefined)).toEqual({ light: NEUTRAL_ENTRY.light, dark: NEUTRAL_ENTRY.dark });
    expect(categoryColors('red')).toEqual({ light: NEUTRAL_ENTRY.light, dark: NEUTRAL_ENTRY.dark });
  });

  it('derive triplets from any other color, keeping its hue', () => {
    const { light, dark } = categoryColors('#d97706');
    expect(light).not.toEqual(dark);
    for (const color of [light.text, light.border, dark.text, dark.border]) expect(Math.abs(hue(color) - hue('#d97706'))).toBeLessThan(12);
  });

  // A grid over the RGB cube, extremes included: black, white, pure and dull hues.
  const SAMPLES: string[] = [];
  for (let r = 0; r <= 255; r += 51) for (let g = 0; g <= 255; g += 51) for (let b = 0; b <= 255; b += 51) SAMPLES.push(toHex([r, g, b]));

  it.each(THEMES)('derived from any user color pass the contrast rules, %s theme', (theme) => {
    const failures = SAMPLES.flatMap((hex) => tripletProblems(deriveTriplet(hex, theme), theme).map((problem) => `${hex}: ${problem}`));
    expect(failures).toEqual([]);
  });
});
