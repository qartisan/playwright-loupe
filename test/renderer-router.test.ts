import { describe, expect, it } from 'vitest';
import { formatHash, parseHash, redirectHash, type AppLocation } from '../src/renderer/router.js';

describe('parseHash', () => {
  it.each(['', '#', '#/', '/', '#//'])('reads %j as the dashboard', (hash) => {
    expect(parseHash(hash)).toEqual({ route: { page: 'dashboard' }, search: '' });
  });

  it('reads the errors and suite health views, with or without a trailing slash', () => {
    expect(parseHash('#/errors').route).toEqual({ page: 'errors' });
    expect(parseHash('#/health/').route).toEqual({ page: 'health' });
  });

  it('reads the errors view scrolled to a category', () => {
    expect(parseHash('#/errors/category/Locator%20not%20found').route).toEqual({ page: 'errors', category: 'Locator not found' });
  });

  it('reads the former run errors path as the errors view', () => {
    expect(parseHash('#/run-errors').route).toEqual({ page: 'errors' });
  });

  it('reads a test route', () => {
    expect(parseHash('#/test/0123456789abcdef').route).toEqual({ page: 'test', id: '0123456789abcdef', repeatEachIndex: 0 });
  });

  it('reads a repeated test route', () => {
    expect(parseHash('#/test/abc/repeat/3').route).toEqual({ page: 'test', id: 'abc', repeatEachIndex: 3 });
  });

  it('reads an error group route', () => {
    expect(parseHash('#/group/3f2a9c0d1e4b').route).toEqual({ page: 'group', signature: '3f2a9c0d1e4b' });
  });

  it('decodes encoded segments', () => {
    expect(parseHash('#/test/a%2Fb%20c').route).toEqual({ page: 'test', id: 'a/b c', repeatEachIndex: 0 });
  });

  it.each(['#/nope', '#/test', '#/test/abc/repeat', '#/test/abc/repeat/-1', '#/test/abc/repeat/01', '#/test/abc/repeat/x', '#/test/abc/extra', '#/run-errors/x', '#/errors/x', '#/errors/category', '#/errors/category/a/b', '#/constructor', '#/toString', '#/group', '#/group/abc/extra', '#/test/%E0%A4%A'])(
    'reads %j as not found',
    (hash) => {
      expect(parseHash(hash).route.page).toBe('not-found');
    },
  );

  it('reads the tests view', () => {
    expect(parseHash('#/tests').route).toEqual({ page: 'tests' });
  });

  it('keeps the query after the path raw, for the filters module to decode', () => {
    expect(parseHash('#/test/abc?status=failed&q=login%20page%2Cx')).toEqual({
      route: { page: 'test', id: 'abc', repeatEachIndex: 0 },
      search: 'status=failed&q=login%20page%2Cx',
    });
    expect(parseHash('#?status=failed')).toEqual({ route: { page: 'dashboard' }, search: 'status=failed' });
  });
});

describe('formatHash', () => {
  it('formats each route', () => {
    expect(formatHash({ route: { page: 'dashboard' }, search: '' })).toBe('#/');
    expect(formatHash({ route: { page: 'errors' }, search: '' })).toBe('#/errors');
    expect(formatHash({ route: { page: 'health' }, search: '' })).toBe('#/health');
    expect(formatHash({ route: { page: 'errors', category: 'Server error' }, search: '' })).toBe('#/errors/category/Server%20error');
    expect(formatHash({ route: { page: 'test', id: 'abc', repeatEachIndex: 0 }, search: '' })).toBe('#/test/abc');
    expect(formatHash({ route: { page: 'test', id: 'abc', repeatEachIndex: 2 }, search: '' })).toBe('#/test/abc/repeat/2');
    expect(formatHash({ route: { page: 'group', signature: '3f2a9c0d1e4b' }, search: '' })).toBe('#/group/3f2a9c0d1e4b');
  });

  it('encodes ids and writes the query as is', () => {
    expect(formatHash({ route: { page: 'test', id: 'a/b?c#d', repeatEachIndex: 0 }, search: 'a=x%20y%26z&z=1' })).toBe(
      '#/test/a%2Fb%3Fc%23d?a=x%20y%26z&z=1',
    );
    expect(formatHash({ route: { page: 'tests' }, search: '' })).toBe('#/tests');
  });

  it.each<AppLocation>([
    { route: { page: 'dashboard' }, search: '' },
    { route: { page: 'errors' }, search: 'status=failed' },
    { route: { page: 'health' }, search: '' },
    { route: { page: 'tests' }, search: 'status=failed,flaky' },
    { route: { page: 'errors', category: 'a/b ? #' }, search: '' },
    { route: { page: 'test', id: 'f67dffbfbe9d1c0b', repeatEachIndex: 0 }, search: '' },
    { route: { page: 'test', id: 'weird / id ? # %', repeatEachIndex: 4 }, search: 'q=a%3Db%26c&tag=%40smoke' },
    { route: { page: 'group', signature: 'a/b c' }, search: '' },
  ])('round-trips %j', (location) => {
    expect(parseHash(formatHash(location))).toEqual(location);
  });

  it('keeps an unknown path as is', () => {
    const location = parseHash('#/somewhere/else');
    expect(formatHash(location)).toBe('#/somewhere/else');
  });
});

describe('redirectHash', () => {
  it('sends the former run errors path to the errors view, keeping the query', () => {
    expect(redirectHash('#/run-errors')).toBe('#/errors');
    expect(redirectHash('#/run-errors/?tag=%40smoke')).toBe('#/errors?tag=%40smoke');
  });

  it.each(['', '#/', '#/errors', '#/test/abc', '#/run-errors/x', '#/constructor'])('leaves %j alone', (hash) => {
    expect(redirectHash(hash)).toBeNull();
  });
});
