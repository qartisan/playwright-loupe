import { describe, expect, it } from 'vitest';
import { parseHash } from '../src/renderer/router.js';
import { focusesHeading, isPageChange, pageTitle, type FocusContext } from '../src/renderer/viewChange.js';

const route = (hash: string) => parseHash(hash).route;

describe('isPageChange', () => {
  it('is never true on the first load', () => {
    for (const hash of ['#/', '#/tests', '#/test/abc', '#/errors/category/Timeout']) expect(isPageChange(null, route(hash))).toBe(false);
  });

  it.each([
    ['another view', '#/', '#/tests'],
    ['the errors view to a category', '#/errors', '#/errors/category/Timeout'],
    ['another category', '#/errors/category/Timeout', '#/errors/category/Network'],
    ['a test from the tests view', '#/tests?status=failed', '#/test/abc?status=failed'],
    ['another test (j / k)', '#/test/abc', '#/test/def'],
    ['another repeat of the same test', '#/test/abc', '#/test/abc/repeat/1'],
    ['another error group (n / p)', '#/group/a1', '#/group/b2'],
    ['back from a test to the tests view', '#/test/abc', '#/tests'],
    ['an unknown page', '#/tests', '#/nope'],
  ])('is true for %s', (_, from, to) => {
    expect(isPageChange(route(from), route(to))).toBe(true);
  });

  it.each([
    ['a filter', '#/tests', '#/tests?status=failed'],
    ['a search', '#/tests?status=failed', '#/tests?q=login&status=failed'],
    ['a sort', '#/tests', '#/tests?sort=duration:desc'],
    ['a filter while on a test', '#/test/abc', '#/test/abc?status=failed'],
    ['an attempt ([ / ])', '#/test/abc?attempt=0', '#/test/abc?attempt=1'],
    ['the steps toggle', '#/test/abc', '#/test/abc?steps=all'],
    ['the same page', '#/health', '#/health'],
    ['a former path of the same view', '#/run-errors', '#/errors'],
  ])('is false for %s', (_, from, to) => {
    expect(isPageChange(route(from), route(to))).toBe(false);
  });
});

describe('focusesHeading', () => {
  const none: FocusContext = { inTree: false, narrow: false, categoryFocused: false };

  it('focuses the heading on a page change only', () => {
    expect(focusesHeading(route('#/tests'), route('#/test/abc'), none)).toBe(true);
    expect(focusesHeading(route('#/tests'), route('#/tests?status=failed'), none)).toBe(false);
    expect(focusesHeading(null, route('#/tests'), none)).toBe(false);
  });

  it('keeps focus in the sidebar tree on wide screens, where the tree stays visible', () => {
    expect(focusesHeading(route('#/'), route('#/test/abc'), { ...none, inTree: true })).toBe(false);
  });

  it('leaves the tree on narrow screens, where the sidebar overlay closes', () => {
    expect(focusesHeading(route('#/'), route('#/test/abc'), { ...none, inTree: true, narrow: true })).toBe(true);
  });

  it('keeps focus on the category the errors view was opened on', () => {
    expect(focusesHeading(route('#/'), route('#/errors/category/Timeout'), { ...none, categoryFocused: true })).toBe(false);
    expect(focusesHeading(route('#/'), route('#/errors/category/Unknown'), none)).toBe(true);
  });
});

describe('pageTitle', () => {
  const tests = [
    { id: 'abc', repeatEachIndex: 0, title: 'adds an item to the cart' },
    { id: 'abc', repeatEachIndex: 2, title: 'adds an item to the cart' },
  ];

  it.each([
    ['#/', 'Overview · Storefront'],
    ['#/errors', 'Errors · Storefront'],
    ['#/errors/category/Locator%20not%20found', 'Locator not found · Storefront'],
    ['#/health', 'Suite health · Storefront'],
    ['#/tests?status=failed&sort=duration:desc', 'Tests · Storefront'],
    ['#/test/abc?attempt=1', 'adds an item to the cart · Storefront'],
    ['#/test/abc/repeat/2', 'adds an item to the cart (repeat 2) · Storefront'],
    ['#/group/3f2a9c0d1e4b', 'Error group · Storefront'],
    ['#/test/unknown', 'Not found · Storefront'],
    ['#/nope', 'Not found · Storefront'],
  ])('titles %s as %j', (hash, title) => {
    expect(pageTitle(route(hash), tests, 'Storefront')).toBe(title);
  });

  it.each(['', '   '])('falls back to Loupe without a suite name (%j)', (suite) => {
    expect(pageTitle(route('#/tests'), tests, suite)).toBe('Tests · Loupe');
  });

  it('trims the suite name', () => {
    expect(pageTitle(route('#/'), tests, '  Nightly  ')).toBe('Overview · Nightly');
  });
});
