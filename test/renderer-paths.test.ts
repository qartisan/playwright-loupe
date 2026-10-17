import { describe, expect, it } from 'vitest';
import { commonDirectoryPrefix, splitForMiddleEllipsis, stripPrefix } from '../src/renderer/paths.js';

describe('commonDirectoryPrefix', () => {
  it('finds the longest shared directory', () => {
    expect(commonDirectoryPrefix(['tests/e2e/a.spec.ts', 'tests/e2e/api/b.spec.ts', 'tests/e2e/ui/c.spec.ts'])).toBe('tests/e2e/');
  });

  it('is empty without a shared directory', () => {
    expect(commonDirectoryPrefix(['a.spec.ts', 'tests/b.spec.ts'])).toBe('');
    expect(commonDirectoryPrefix(['api/a.spec.ts', 'ui/b.spec.ts'])).toBe('');
    expect(commonDirectoryPrefix([])).toBe('');
  });

  it('only counts whole directories', () => {
    expect(commonDirectoryPrefix(['tests/a.spec.ts', 'tests-b/c.spec.ts'])).toBe('');
    expect(commonDirectoryPrefix(['e2e/login/a.spec.ts', 'e2e/logout/b.spec.ts'])).toBe('e2e/');
  });

  it('gives the directory of a single file', () => {
    expect(commonDirectoryPrefix(['tests/api/users.spec.ts'])).toBe('tests/api/');
    expect(commonDirectoryPrefix(['users.spec.ts'])).toBe('');
  });

  it('normalizes Windows separators', () => {
    expect(commonDirectoryPrefix(['tests\\e2e\\a.spec.ts', 'tests/e2e\\api\\b.spec.ts'])).toBe('tests/e2e/');
    expect(stripPrefix('tests\\e2e\\api\\b.spec.ts', 'tests/e2e/')).toBe('api/b.spec.ts');
  });

  it('strips only a matching prefix', () => {
    expect(stripPrefix('tests/a.spec.ts', 'tests/')).toBe('a.spec.ts');
    expect(stripPrefix('other/a.spec.ts', 'tests/')).toBe('other/a.spec.ts');
    expect(stripPrefix('a.spec.ts', '')).toBe('a.spec.ts');
  });
});

describe('splitForMiddleEllipsis', () => {
  it('keeps a compound extension and the end of a long name in the tail', () => {
    expect(splitForMiddleEllipsis('checkout-flow-guest.spec.ts')).toEqual(['checkout-flow-g', 'uest.spec.ts']);
  });

  it('keeps at least the extension of a short name', () => {
    expect(splitForMiddleEllipsis('login.spec.ts')).toEqual(['login', '.spec.ts']);
    expect(splitForMiddleEllipsis('a.ts')).toEqual(['a', '.ts']);
  });

  it('handles names without an extension, dotfiles and dotted stems', () => {
    expect(splitForMiddleEllipsis('Makefile')).toEqual(['Makefile', '']);
    expect(splitForMiddleEllipsis('.eslintrc')).toEqual(['.eslintrc', '']);
    expect(splitForMiddleEllipsis('users.integration-suite.spec.ts')).toEqual(['users.integration-s', 'uite.spec.ts']);
  });

  it('never loses a character', () => {
    for (const name of ['checkout-flow-guest.spec.ts', 'x.y', 'no-extension-but-very-long-name', 'a.b.c.d.e.ts']) {
      expect(splitForMiddleEllipsis(name).join('')).toBe(name);
    }
  });
});
