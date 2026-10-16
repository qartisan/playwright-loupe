/**
 * Category palette: the single source of truth for category colors, imported
 * by the reporter (names → reference colors written to the report) and by the
 * renderer (reference colors → per-theme badge colors).
 *
 * Each entry has a name usable in the config (`color: 'teal'`), a reference
 * color (the `#rrggbb` value the report carries) and hand-tuned text /
 * background / border triplets per theme. The hues avoid reds and greens, so
 * a category never reads as a failed or passed status. The contrast and
 * distance rules are checked by `test/palette.test.ts`.
 *
 * The order matters: categories without a configured color take the free
 * entries in this order.
 *
 * Kept free of Node imports so the renderer can import it.
 */

export interface PaletteTriplet {
  text: string;
  bg: string;
  border: string;
}

export interface PaletteEntry {
  name: string;
  /** The `#rrggbb` color written to the report for this entry. */
  reference: string;
  light: PaletteTriplet;
  dark: PaletteTriplet;
}

export const PALETTE_ENTRIES: readonly PaletteEntry[] = [
  {
    name: 'blue',
    reference: '#466cc8',
    light: { text: '#385db7', bg: '#eaf0fe', border: '#5981df' },
    dark: { text: '#9ebdff', bg: '#18233c', border: '#577cd3' },
  },
  {
    name: 'cyan',
    reference: '#0a7da1',
    light: { text: '#0a708f', bg: '#e0f4fd', border: '#2b8fb4' },
    dark: { text: '#60cdf5', bg: '#002837', border: '#268cb1' },
  },
  {
    name: 'teal',
    reference: '#04837c',
    light: { text: '#09726c', bg: '#dbf7f4', border: '#29958e' },
    dark: { text: '#6ed2c9', bg: '#002b28', border: '#25928b' },
  },
  {
    name: 'violet',
    reference: '#8656b7',
    light: { text: '#7747a7', bg: '#f4ecfe', border: '#9e6ed2' },
    dark: { text: '#cfaafc', bg: '#2a1d37', border: '#9468c3' },
  },
  {
    name: 'magenta',
    reference: '#ad4681',
    light: { text: '#9d3772', bg: '#feeaf3', border: '#cc629d' },
    dark: { text: '#f79dcc', bg: '#351928', border: '#bb598f' },
  },
  {
    name: 'orange',
    reference: '#ab5803',
    light: { text: '#954d09', bg: '#feece1', border: '#c6702b' },
    dark: { text: '#f9a970', bg: '#361d0a', border: '#bc671f' },
  },
  {
    // Low chroma: the hue circle has no room left without reds or greens, so
    // this entry stands apart by lightness (dark in light theme).
    name: 'brown',
    reference: '#745f43',
    light: { text: '#3c2d18', bg: '#f5e9d9', border: '#60503a' },
    dark: { text: '#b7a182', bg: '#302412', border: '#ae9779' },
  },
  // Last: never a built-in category, and the last color given to a category
  // without one. It is the hue closest to the flaky status amber.
  {
    name: 'gold',
    reference: '#b9a542',
    light: { text: '#736308', bg: '#f5f1da', border: '#9a861a' },
    dark: { text: '#d2be5d', bg: '#2b2403', border: '#94800e' },
  },
];

/** The uncategorized bucket: neutral grey, not selectable by name. */
export const NEUTRAL_ENTRY: PaletteEntry = {
  name: 'neutral',
  reference: '#6b6b6b',
  light: { text: '#636363', bg: '#f0f0f0', border: '#868686' },
  dark: { text: '#bebebe', bg: '#242424', border: '#808080' },
};

/** Names accepted by `categories.rules[].color`, in palette order. */
export const PALETTE_NAMES: readonly string[] = PALETTE_ENTRIES.map((entry) => entry.name);

/** Reference color of a palette entry; throws for an unknown name (config validation reports it first). */
export function paletteReference(name: string): string {
  const entry = PALETTE_ENTRIES.find((candidate) => candidate.name === name);
  if (!entry) throw new Error(`unknown palette color "${name}"; known colors: ${PALETTE_NAMES.join(', ')}`);
  return entry.reference;
}

/** The palette entry (or the neutral one) whose reference color is `hex`, case-insensitive; null for any other color. */
export function paletteEntryByReference(hex: string): PaletteEntry | null {
  const lower = hex.toLowerCase();
  return [...PALETTE_ENTRIES, NEUTRAL_ENTRY].find((entry) => entry.reference === lower) ?? null;
}
