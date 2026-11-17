import { describe, expect, it } from 'vitest';
import { maskReport } from '../src/core/build.js';
import { OUTPUT_LIMIT, maskOutput } from '../src/core/output.js';
import { createPathRewriter } from '../src/core/paths.js';
import { createRedactor } from '../src/core/redact.js';
import type { LoupeReport, Output } from '../src/schema/v1.js';

/**
 * Outputs are masked before they are cut (brief 26s): a value or a home
 * directory running across the cut must be masked as if there were no cut.
 * As `buildReport` does it, with the real redactor and path rewriter: each
 * output masked and cut as it is collected (`maskOutput`), then the report's
 * last pass (`maskReport`).
 */

const SECRET = 'S3cr3tTokenValue0123456789';
/** 120 characters: each occurrence shrinks the text by 110. */
const LONG = 'L0ngS3cretValue!'.repeat(8).slice(0, 120);
/** 6 characters, the shortest value used: each occurrence grows the text by 4. */
const SHORT = 'ab12cd';
const HOME = '/home/someuser';

const redactor = createRedactor({ mode: 'extend', patterns: [], values: [SECRET, LONG, SHORT] });
const paths = createPathRewriter({ roots: ['/work/app'], home: HOME });

/**
 * A value to place across the cut. `private`: the words that must never show, not even their first
 * 3 characters (the user name, the secret). `cutFirstLeaks`: cut before masking, as up to 0.3.2, a
 * part of it shows at some offset; a generic Windows home does not, since its rule masks a name cut short.
 */
interface Placed {
  name: string;
  text: string;
  private: readonly string[];
  cutFirstLeaks: boolean;
}

const PLACED: readonly Placed[] = [
  { name: 'a redact.env value', text: SECRET, private: [SECRET], cutFirstLeaks: true },
  // Glued to the text before it: only the real home's own rule masks it, with no boundary.
  { name: 'the real home', text: `-L${HOME}/lib`, private: ['someuser'], cutFirstLeaks: true },
  { name: 'a generic POSIX home with a space', text: '/Users/John loupecanary/a.json', private: ['John', 'loupecanary'], cutFirstLeaks: true },
  { name: 'a generic Windows home', text: 'C:\\Users\\loupecanary\\a.json', private: ['loupecanary'], cutFirstLeaks: false },
];

function reportWith(stdout: Output, stderr: Output): LoupeReport {
  return {
    run: { errors: [] },
    projects: [],
    tests: [{ project: 'p', suitePath: [], title: 't', dimensions: {}, attempts: [{ stdout, stderr }] }],
  } as unknown as LoupeReport;
}

function masked(stdout: string, stderr = stdout): { stdout: Output; stderr: Output } {
  // Written in two chunks split at the limit, as Playwright may hand them over.
  const collected = (text: string): Output => maskOutput([text.slice(0, OUTPUT_LIMIT), text.slice(OUTPUT_LIMIT)], redactor, paths);
  const attempt = maskReport(reportWith(collected(stdout), collected(stderr)), redactor, paths).tests[0]?.attempts[0];
  if (!attempt) throw new Error('no attempt');
  return { stdout: attempt.stdout, stderr: attempt.stderr };
}

/** Shortest start of a private word searched for: 3 characters, which the filler, `[redacted]` and `~/` never hold. */
const MIN_PART = 3;

/** The longest start of a private word of `placed` found in `text`, or null. */
function leaked(text: string, placed: Placed): string | null {
  for (const word of placed.private) {
    for (let length = word.length; length >= MIN_PART; length--) {
      if (text.includes(word.slice(0, length))) return word.slice(0, length);
    }
  }
  return null;
}

/**
 * The value at `offset`, between spaces (a boundary before it), then a line end and more text: a Windows
 * profile name runs to the end of its line, and the output must still be over the limit once masked.
 */
const placedAt = (offset: number, placed: Placed, before = '', after = ''): string =>
  `${before}${' '.repeat(offset)}${placed.text}${' '.repeat(64)}\n${'.'.repeat(256)}${after}`;

// The sweeps mask thousands of outputs of 33 to 70 kB: about 1 s for the longest on the desktop alone, over
// 5 s (Vitest's default) beside the other test files, and 4 to 5 times more on a slower machine.
describe('an output masked before it is cut', { timeout: 60_000 }, () => {
  for (const placed of PLACED) {
    it(`masks ${placed.name} at every offset across the cut`, () => {
      const start = OUTPUT_LIMIT - placed.text.length - 64;
      let crossed = 0;
      for (let offset = start; offset <= OUTPUT_LIMIT + 64; offset++) {
        const raw = placedAt(offset, placed);
        const { stdout, stderr } = masked(raw);
        expect(stdout.truncated).toBe(true);
        expect(stdout.text.length).toBeLessThanOrEqual(OUTPUT_LIMIT);
        expect(leaked(stdout.text, placed), `offset ${offset}`).toBeNull();
        expect(leaked(stderr.text, placed), `offset ${offset}`).toBeNull();
        // Positive control: cut before masking (the order up to 0.3.2), the same search finds a part of it.
        if (leaked(paths.text(redactor.strings(raw.slice(0, OUTPUT_LIMIT))), placed) !== null) crossed++;
      }
      expect(crossed > 0).toBe(placed.cutFirstLeaks);
    });
  }

  it('masks a value at the edge of any margin when long values before it shrink the text', () => {
    // 250 values of 120 characters before the cut: the masked text is 27,500 characters shorter, so a cut
    // made before masking, even with a margin of up to 1,024 characters, ends inside what the final text keeps.
    const shrink = `${LONG} `.repeat(250);
    const tail = ' '.repeat(40_000);
    const leaks: string[] = [];
    let untruncated = 0;
    for (const placed of [PLACED[0], PLACED[1]] as Placed[]) {
      for (let offset = OUTPUT_LIMIT - shrink.length; offset <= OUTPUT_LIMIT - shrink.length + 1024 + 64; offset++) {
        const { stdout } = masked(placedAt(offset, placed, shrink, tail), '');
        const part = leaked(stdout.text, placed);
        if (part !== null) leaks.push(`${placed.name}, offset ${offset}: ${part}`);
        if (!stdout.truncated || !stdout.text.startsWith('[redacted] [redacted] ')) untruncated++;
      }
    }
    // Leaks first: what a cut made before masking leaves in clear.
    expect(leaks).toEqual([]);
    expect(untruncated).toBe(0);
  });

  it('masks a value across the cut and keeps the limit when short values before it grow the text', () => {
    // 2,000 values of 6 characters become `[redacted]`: 8,000 characters longer, so the value at the final cut
    // was 8,000 characters before it in the output Playwright gave.
    const grow = `${SHORT} `.repeat(2000);
    const growth = 2000 * ('[redacted]'.length - SHORT.length);
    for (const placed of PLACED) {
      const center = OUTPUT_LIMIT - growth - grow.length;
      for (let offset = center - placed.text.length - 16; offset <= center + 16; offset++) {
        const { stdout } = masked(placedAt(offset, placed, grow, ' '.repeat(1000)), '');
        expect(stdout.truncated).toBe(true);
        expect(stdout.text.length).toBeLessThanOrEqual(OUTPUT_LIMIT);
        expect(leaked(stdout.text, placed), `${placed.name}, offset ${offset}`).toBeNull();
      }
    }
  });

  it('leaves an output under the limit as masking alone makes it (control)', () => {
    const raw = `${SECRET} -L${HOME}/lib /work/app/tests/a.spec.ts ?token=abc123 C:\\Users\\loupecanary\\x\n`.repeat(100);
    expect(raw.length).toBeLessThan(OUTPUT_LIMIT);
    const { stdout } = masked(raw);
    expect(stdout).toEqual({ text: paths.text(redactor.strings(raw)), truncated: false });
    expect(stdout.text).toContain('[redacted] -L~/lib tests/a.spec.ts ?token=[redacted] ~/x\n');
  });

  it('keeps whole an output that masking brings under the limit', () => {
    const raw = `${`${LONG}\n`.repeat(10)}${'x'.repeat(OUTPUT_LIMIT - 500)}`;
    expect(raw.length).toBeGreaterThan(OUTPUT_LIMIT);
    const { stdout } = masked(raw);
    expect(stdout.truncated).toBe(false);
    expect(stdout.text).toBe(`${'[redacted]\n'.repeat(10)}${'x'.repeat(OUTPUT_LIMIT - 500)}`);
  });
});
