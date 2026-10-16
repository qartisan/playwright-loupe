import { describe, expect, it } from 'vitest';
import { formatHash, parseHash, redirectHash, type AppLocation } from '../src/renderer/router.js';

describe('parseHash', () => {
  it.each(['', '#', '#/', '/', '#//'])('reads %j as the dashboard', (hash) => {
    expect(parseHash(hash)).toEqual({ route: { page: 'dashboard' }, query: {} });
  });

  it('reads the errors and suite health views, with or without a trailing slash', () => {
    expect(parseHash('#/errors').route).toEqual({ page: 'errors' });
    expect(parseHash('#/health/').route).toEqual({ page: 'health' });
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

  it.each(['#/nope', '#/test', '#/test/abc/repeat', '#/test/abc/repeat/-1', '#/test/abc/repeat/01', '#/test/abc/repeat/x', '#/test/abc/extra', '#/run-errors/x', '#/errors/x', '#/constructor', '#/toString', '#/group', '#/group/abc/extra', '#/test/%E0%A4%A'])(
    'reads %j as not found',
    (hash) => {
      expect(parseHash(hash).route.page).toBe('not-found');
    },
  );

  it('reads the query after the path', () => {
    expect(parseHash('#/test/abc?status=failed&q=login%20page')).toEqual({
      route: { page: 'test', id: 'abc', repeatEachIndex: 0 },
      query: { status: 'failed', q: 'login page' },
    });
    expect(parseHash('#?status=failed')).toEqual({ route: { page: 'dashboard' }, query: { status: 'failed' } });
  });
});

describe('formatHash', () => {
  it('formats each route', () => {
    expect(formatHash({ route: { page: 'dashboard' }, query: {} })).toBe('#/');
    expect(formatHash({ route: { page: 'errors' }, query: {} })).toBe('#/errors');
    expect(formatHash({ route: { page: 'health' }, query: {} })).toBe('#/health');
    expect(formatHash({ route: { page: 'test', id: 'abc', repeatEachIndex: 0 }, query: {} })).toBe('#/test/abc');
    expect(formatHash({ route: { page: 'test', id: 'abc', repeatEachIndex: 2 }, query: {} })).toBe('#/test/abc/repeat/2');
    expect(formatHash({ route: { page: 'group', signature: '3f2a9c0d1e4b' }, query: {} })).toBe('#/group/3f2a9c0d1e4b');
  });

  it('encodes ids and sorts query keys, so a location has a single form', () => {
    expect(formatHash({ route: { page: 'test', id: 'a/b?c#d', repeatEachIndex: 0 }, query: { z: '1', a: 'x y&z' } })).toBe(
      '#/test/a%2Fb%3Fc%23d?a=x+y%26z&z=1',
    );
  });

  it.each<AppLocation>([
    { route: { page: 'dashboard' }, query: {} },
    { route: { page: 'errors' }, query: { status: 'failed' } },
    { route: { page: 'health' }, query: {} },
    { route: { page: 'test', id: 'f67dffbfbe9d1c0b', repeatEachIndex: 0 }, query: {} },
    { route: { page: 'test', id: 'weird / id ? # %', repeatEachIndex: 4 }, query: { q: 'a=b&c', tag: '@smoke' } },
    { route: { page: 'group', signature: 'a/b c' }, query: {} },
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
