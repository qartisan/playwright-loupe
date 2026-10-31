import { test } from '@playwright/test';

const body = async () => {};

test('@first in the title', body);
test('in the title @layer:api', body);
test('in the title @layer:api and more', body);
test('from test', { tag: ['@a', '@b:c'] }, body);
test('from test and more', body);
test.describe('from describe', { tag: '@d' }, () => {
  test('one', body);
  test('two', { tag: '@own' }, body);
  test.describe('nested', { tag: '@n' }, () => {
    test('three @inline', { tag: '@own2' }, body);
  });
});
// No title: the tag follows the file in the string `-g` matches.
test.describe('', { tag: '@untitled' }, () => {
  test('in a describe without a title', body);
  test('in a describe without a title 2', body);
});
test.describe(() => {
  test('in an anonymous describe', body);
});
test.describe.serial('serial', { tag: '@s' }, () => {
  test('in a serial describe', body);
});
test.describe('mixed', () => {
  test('tagged', { tag: '@m' }, body);
  test('untagged', body);
});
test.skip('skipped', { tag: '@skip' }, body);
test.fixme('fixme', { tag: '@fixme' }, body);
test('both @x', { tag: '@x' }, body);
test('foo@bar', body);
test('foo@bar2', body);
