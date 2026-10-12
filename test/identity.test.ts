import { createHash } from 'node:crypto';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeTestId, relativePosix } from '../src/core/identity.js';

describe('computeTestId', () => {
  it('is the first 16 hex chars of sha256 over NUL-joined project, file and title path', () => {
    const expected = createHash('sha256').update('chromium\0login.spec.ts\0auth\0logs in').digest('hex').slice(0, 16);
    expect(computeTestId('chromium', 'login.spec.ts', ['auth', 'logs in'])).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is stable across calls', () => {
    expect(computeTestId('p', 'a.spec.ts', ['t'])).toBe(computeTestId('p', 'a.spec.ts', ['t']));
  });

  it('gives two ids to the same title in two projects', () => {
    expect(computeTestId('chromium', 'a.spec.ts', ['suite', 'test'])).not.toBe(
      computeTestId('firefox', 'a.spec.ts', ['suite', 'test']),
    );
  });

  it('gives two ids to the same title in two files', () => {
    expect(computeTestId('chromium', 'a.spec.ts', ['suite', 'test'])).not.toBe(
      computeTestId('chromium', 'b.spec.ts', ['suite', 'test']),
    );
  });

  it('gives two ids to the same title under different describe blocks', () => {
    expect(computeTestId('p', 'a.spec.ts', ['one', 'test'])).not.toBe(computeTestId('p', 'a.spec.ts', ['two', 'test']));
  });

  it('cannot be confused by titles that join the same way', () => {
    // A plain separator such as ' > ' would make these collide; NUL cannot appear in titles.
    expect(computeTestId('p', 'a.spec.ts', ['a > b', 'c'])).not.toBe(computeTestId('p', 'a.spec.ts', ['a', 'b > c']));
  });

  it('works with an unnamed project', () => {
    expect(computeTestId('', 'a.spec.ts', ['t'])).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('relativePosix', () => {
  it('returns a POSIX path relative to the root', () => {
    expect(relativePosix('/repo/tests', '/repo/tests/auth/login.spec.ts', path.posix)).toBe('auth/login.spec.ts');
  });

  it('returns "." for the root itself', () => {
    expect(relativePosix('/repo/tests', '/repo/tests', path.posix)).toBe('.');
  });

  it('keeps ".." segments for files outside the root', () => {
    expect(relativePosix('/repo/tests', '/repo/shared/helpers.ts', path.posix)).toBe('../shared/helpers.ts');
  });

  it('converts Windows separators', () => {
    expect(relativePosix('C:\\repo\\tests', 'C:\\repo\\tests\\auth\\login.spec.ts', path.win32)).toBe(
      'auth/login.spec.ts',
    );
    expect(relativePosix('C:\\repo\\tests', 'C:\\repo\\shared\\a.ts', path.win32)).toBe('../shared/a.ts');
  });

  it('gives the same path on Windows and POSIX for the same layout', () => {
    expect(relativePosix('C:\\r\\tests', 'C:\\r\\tests\\x\\y.spec.ts', path.win32)).toBe(
      relativePosix('/r/tests', '/r/tests/x/y.spec.ts', path.posix),
    );
  });
});
