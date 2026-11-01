import { test } from '@playwright/test';
import { KEYS } from './keys.js';

// Each name as a title, a describe, a tag prefix, a tag value, a tag, an annotation
// type, an attachment name and a content type. With LOUPE_FIXTURE_FAIL, each test
// fails on purpose, so that the name is a category too.

for (const key of KEYS) {
  test.describe(key, () => {
    test(key, { tag: [`@${key}:prefix`, `@value:${key}`, `@${key}`], annotation: { type: key, description: key } }, async ({}, testInfo) => {
      await testInfo.attach(key, { body: 'x'.repeat(5000), contentType: key });
      if (process.env['LOUPE_FIXTURE_FAIL']) throw new Error(`failure ${key}`);
    });
  });
}
