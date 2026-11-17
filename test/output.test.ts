import { describe, expect, it } from 'vitest';
import { OUTPUT_LIMIT, collectOutput, limitOutput } from '../src/core/output.js';

describe('collectOutput', () => {
  it('joins string and Buffer chunks', () => {
    expect(collectOutput(['a\n', Buffer.from('b\n')])).toEqual({ text: 'a\nb\n', truncated: false });
  });

  it('returns empty text without output', () => {
    expect(collectOutput([])).toEqual({ text: '', truncated: false });
  });

  it('strips ANSI codes', () => {
    expect(collectOutput([`${String.fromCharCode(27)}[32mok${String.fromCharCode(27)}[39m`]).text).toBe('ok');
  });

  it('keeps the whole output: it is cut once masked (limitOutputs)', () => {
    const text = 'x'.repeat(OUTPUT_LIMIT + 10);
    expect(collectOutput([text])).toEqual({ text, truncated: false });
  });
});

describe('limitOutput', () => {
  it('keeps output at the limit as is', () => {
    const text = 'x'.repeat(OUTPUT_LIMIT);
    expect(limitOutput(text)).toEqual({ text, truncated: false });
  });

  it('keeps the beginning and flags truncated output', () => {
    const output = limitOutput(`start${'x'.repeat(OUTPUT_LIMIT)}`);
    expect(output.truncated).toBe(true);
    expect(output.text).toHaveLength(OUTPUT_LIMIT);
    expect(output.text.startsWith('start')).toBe(true);
  });

  it('does not split a surrogate pair', () => {
    expect(limitOutput('ab🔍cd', 3)).toEqual({ text: 'ab', truncated: true });
  });
});
