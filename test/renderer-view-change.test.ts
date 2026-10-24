import { describe, expect, it } from 'vitest';
import { parseHash } from '../src/renderer/router.js';
import { announcesPage, focusesHeading, isPageChange, pageName, pageTitle, type ChangeContext } from '../src/renderer/viewChange.js';

const route = (hash: string) => parseHash(hash).route;

describe('isPageChange', () => {
  it('is never true on the first load', () => {
    for (const hash of ['#/', '#/tests', '#/test/abc', '#/errors/category/Timeout']) expect(isPageChange(null, route(hash))).toBe(false);
  });

  it.each([
    ['another view', '#/', '#/tests'],
    ['the errors view to a category', '#/errors', '#/errors/category/Timeout'],
    ['another category', '#/errors/category/Timeout', '#/errors/category/Network'],
    ['the overview to its run details', '#/', '#/run-details'],
    ['the run details from another view', '#/tests', '#/run-details'],
    ['a test from the tests view', '#/tests?status=failed', '#/test/abc?status=failed'],
    ['another test (j / k)', '#/test/abc', '#/test/def'],
    ['another repeat of the same test', '#/test/abc', '#/test/abc/repeat/1'],
    ['another error group (j / k)', '#/group/a1', '#/group/b2'],
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

describe('focusesHeading and announcesPage', () => {
  const other: ChangeContext = { origin: 'other', narrow: false, sectionFocused: false };
  const sidebar: ChangeContext = { ...other, origin: 'sidebar' };
  const effects = (from: string | null, to: string, context: ChangeContext) => ({
    focus: focusesHeading(from === null ? null : route(from), route(to), context),
    announce: announcesPage(from === null ? null : route(from), route(to), context),
  });

  it.each([
    ['a link in the content', '#/', '#/tests'],
    ['j / k', '#/test/abc', '#/test/def'],
    ['j / k on an error group', '#/group/a1', '#/group/b2'],
    ['a view shortcut (o / e / h / t)', '#/test/abc', '#/tests'],
    ['Back / Forward', '#/test/abc', '#/tests'],
  ])('focuses the heading, without announcing, after %s', (_, from, to) => {
    expect(effects(from, to, other)).toEqual({ focus: true, announce: false });
  });

  it.each([
    ['a view link', '#/', '#/health'],
    ['a tree row', '#/tests', '#/test/abc'],
    ['another tree row', '#/test/abc', '#/test/def'],
  ])('keeps focus in the visible sidebar and announces the page after %s', (_, from, to) => {
    expect(effects(from, to, sidebar)).toEqual({ focus: false, announce: true });
  });

  it('focuses the heading, without announcing, when the sidebar is the narrow overlay, which closes', () => {
    expect(effects('#/', '#/health', { ...sidebar, narrow: true })).toEqual({ focus: true, announce: false });
  });

  it('does nothing without a page change: first load, filters, attempts', () => {
    for (const context of [other, sidebar]) {
      expect(effects(null, '#/tests', context)).toEqual({ focus: false, announce: false });
      expect(effects('#/tests', '#/tests?status=failed', context)).toEqual({ focus: false, announce: false });
      expect(effects('#/test/abc', '#/test/abc?attempt=1', context)).toEqual({ focus: false, announce: false });
    }
  });

  it('keeps focus on the section the page was opened on', () => {
    expect(effects('#/', '#/errors/category/Timeout', { ...other, sectionFocused: true })).toEqual({ focus: false, announce: false });
    expect(effects('#/', '#/errors/category/Unknown', other)).toEqual({ focus: true, announce: false });
    expect(effects('#/tests', '#/run-details', { ...other, sectionFocused: true })).toEqual({ focus: false, announce: false });
  });
});

describe('pageName', () => {
  it('is the page part of the title', () => {
    const tests = [{ id: 'abc', repeatEachIndex: 0, title: 'adds an item to the cart' }];
    for (const hash of ['#/', '#/health', '#/test/abc', '#/errors/category/Timeout', '#/group/a1', '#/nope']) {
      expect(pageTitle(route(hash), tests, 'Storefront')).toBe(`${pageName(route(hash), tests)} · Storefront`);
    }
    expect(pageName(route('#/health'), tests)).toBe('Suite health');
  });
});

describe('pageTitle', () => {
  const tests = [
    { id: 'abc', repeatEachIndex: 0, title: 'adds an item to the cart' },
    { id: 'abc', repeatEachIndex: 2, title: 'adds an item to the cart' },
  ];

  it.each([
    ['#/', 'Overview · Storefront'],
    ['#/run-details', 'Overview · Storefront'],
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
