/**
 * Color math shared by the renderer (deriving category colors at render time)
 * and the tests (contrast and distance checks): WCAG 2 contrast, CIEDE2000
 * and OKLCH. Pure functions, no DOM, no Node imports.
 */

export type Rgb = readonly [number, number, number];

/** Text, background and border of a badge, for one theme. */
export interface Triplet {
  text: string;
  bg: string;
  border: string;
}

export type ThemeName = 'light' | 'dark';

/** Surfaces a category badge or swatch may sit on, per theme (the renderer's --bg, --bg-card, --bg-muted). */
export const SURFACES: Readonly<Record<ThemeName, readonly string[]>> = {
  light: ['#f7f5f0', '#ffffff', '#eeeae2'],
  dark: ['#080808', '#0d0d0d', '#161616'],
};

/** WCAG 2.x thresholds: normal text, and non-text UI (borders, icons). */
export const TEXT_CONTRAST = 4.5;
export const UI_CONTRAST = 3;

const HEX = /^#[0-9a-fA-F]{6}$/;

export function isHex(value: string): boolean {
  return HEX.test(value);
}

export function parseHex(hex: string): Rgb {
  if (!isHex(hex)) throw new TypeError(`not a #rrggbb color: ${hex}`);
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((channel) => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, '0')).join('')}`;
}

function toLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function fromLinear(value: number): number {
  const c = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
  return c * 255;
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map(toLinear) as unknown as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, from 1 to 21. */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/* OKLab / OKLCH (Björn Ottosson), used to move a color's lightness while keeping its hue. */

export interface Oklch {
  l: number;
  c: number;
  /** Degrees, 0–360. */
  h: number;
}

export function toOklch(hex: string): Oklch {
  const [r, g, b] = parseHex(hex).map(toLinear) as unknown as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const h = (Math.atan2(B, A) * 180) / Math.PI;
  return { l: L, c: Math.hypot(A, B), h: h < 0 ? h + 360 : h };
}

/** Linear sRGB of an OKLCH color; may fall outside [0, 1] when out of gamut. */
function oklchToLinear({ l: L, c, h }: Oklch): Rgb {
  const A = c * Math.cos((h * Math.PI) / 180);
  const B = c * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** OKLCH to hex, reducing chroma until the color fits in sRGB. */
export function fromOklch(color: Oklch): string {
  let c = color.c;
  for (;;) {
    const rgb = oklchToLinear({ ...color, c });
    if (rgb.every((channel) => channel >= -1e-4 && channel <= 1 + 1e-4) || c <= 0) {
      return toHex(rgb.map((channel) => fromLinear(Math.min(1, Math.max(0, channel)))) as unknown as Rgb);
    }
    c = Math.max(0, c - 0.005);
  }
}

/* CIELAB (D65) and CIEDE2000, the perceptual distance between two colors. */

export function toLab(hex: string): Rgb {
  const [r, g, b] = parseHex(hex).map(toLinear) as unknown as Rgb;
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

const rad = (degrees: number): number => (degrees * Math.PI) / 180;
const deg = (radians: number): number => (radians * 180) / Math.PI;

/** CIEDE2000 color difference; about 2 is barely noticeable, 15+ reads as a different color. */
export function deltaE2000(a: string, b: string): number {
  const [L1, a1, b1] = toLab(a);
  const [L2, a2, b2] = toLab(b);
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar7 = ((C1 + C2) / 2) ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + 25 ** 7)));
  const ap1 = (1 + G) * a1;
  const ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1);
  const Cp2 = Math.hypot(ap2, b2);
  const hue = (bb: number, ap: number): number => (bb === 0 && ap === 0 ? 0 : (deg(Math.atan2(bb, ap)) + 360) % 360);
  const hp1 = hue(b1, ap1);
  const hp2 = hue(b2, ap2);

  const dL = L2 - L1;
  const dC = Cp2 - Cp1;
  let dh = 0;
  if (Cp1 * Cp2 !== 0) {
    dh = hp2 - hp1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin(rad(dh / 2));

  const Lbar = (L1 + L2) / 2;
  const Cbar = (Cp1 + Cp2) / 2;
  let hbar = hp1 + hp2;
  if (Cp1 * Cp2 !== 0) {
    if (Math.abs(hp1 - hp2) <= 180) hbar /= 2;
    else hbar = hp1 + hp2 < 360 ? (hbar + 360) / 2 : (hbar - 360) / 2;
  }
  const T =
    1 - 0.17 * Math.cos(rad(hbar - 30)) + 0.24 * Math.cos(rad(2 * hbar)) + 0.32 * Math.cos(rad(3 * hbar + 6)) - 0.2 * Math.cos(rad(4 * hbar - 63));
  const SL = 1 + (0.015 * (Lbar - 50) ** 2) / Math.sqrt(20 + (Lbar - 50) ** 2);
  const SC = 1 + 0.045 * Cbar;
  const SH = 1 + 0.015 * Cbar * T;
  const Cbar7p = Cbar ** 7;
  const RT = -2 * Math.sqrt(Cbar7p / (Cbar7p + 25 ** 7)) * Math.sin(rad(60 * Math.exp(-(((hbar - 275) / 25) ** 2))));
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}

/* Contrast rules for a category badge, and deriving a badge from any color. */

/** Why a triplet fails the contrast rules, empty when it passes. */
export function tripletProblems(triplet: Triplet, theme: ThemeName): string[] {
  const problems: string[] = [];
  const text = contrast(triplet.text, triplet.bg);
  if (text < TEXT_CONTRAST) problems.push(`text ${triplet.text} on ${triplet.bg}: ${text.toFixed(2)}`);
  for (const background of [triplet.bg, ...SURFACES[theme]]) {
    const border = contrast(triplet.border, background);
    if (border < UI_CONTRAST) problems.push(`border ${triplet.border} on ${background}: ${border.toFixed(2)}`);
  }
  return problems;
}

/** Steps lightness from `start` towards `end` until `passes`; the end value when nothing passes. */
function adjustLightness(base: Oklch, start: number, end: number, passes: (hex: string) => boolean): string {
  const step = start < end ? 0.01 : -0.01;
  for (let l = start; step > 0 ? l <= end : l >= end; l += step) {
    const hex = fromOklch({ ...base, l });
    if (passes(hex)) return hex;
  }
  return fromOklch({ ...base, l: end });
}

/**
 * Badge colors for any color, per theme: a tinted background, and text and
 * border of the same hue whose lightness is moved until the contrast rules
 * pass (text 4.5:1 on the background, border 3:1 on the background and on the
 * page surfaces). The result always passes: at worst the text and border go
 * to the end of the lightness range, black or white.
 */
export function deriveTriplet(hex: string, theme: ThemeName): Triplet {
  const base = toOklch(hex);
  // Greys (no hue) stay grey.
  const chroma = base.c < 0.02 ? 0 : base.c;
  const surfaces = SURFACES[theme];
  if (theme === 'light') {
    const bg = fromOklch({ ...base, l: 0.955, c: Math.min(chroma, 0.03) });
    const text = adjustLightness({ ...base, c: Math.min(chroma, 0.16) }, 0.5, 0, (t) => contrast(t, bg) >= TEXT_CONTRAST);
    const border = adjustLightness({ ...base, c: Math.min(chroma, 0.18) }, 0.66, 0, (b) =>
      [bg, ...surfaces].every((surface) => contrast(b, surface) >= UI_CONTRAST),
    );
    return { text, bg, border };
  }
  const bg = fromOklch({ ...base, l: 0.26, c: Math.min(chroma, 0.05) });
  const text = adjustLightness({ ...base, c: Math.min(chroma, 0.12) }, 0.8, 1, (t) => contrast(t, bg) >= TEXT_CONTRAST);
  const border = adjustLightness({ ...base, c: Math.min(chroma, 0.14) }, 0.6, 1, (b) =>
    [bg, ...surfaces].every((surface) => contrast(b, surface) >= UI_CONTRAST),
  );
  return { text, bg, border };
}
