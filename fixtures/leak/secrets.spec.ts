import { test } from '@playwright/test';
import { SECRETS } from './homes.js';

// Secrets in tags: as a prefix, as a value, and holding the `:` a dimension splits at.

const { LOUPE_LEAK_SECRET: secret, LOUPE_LEAK_OTHER: other, LOUPE_LEAK_COLON: colon } = SECRETS;

test('holds secrets in its tags', { tag: [`@${secret}:x`, `@${other}:y`, `@${colon}`, `@${colon}:z`, `@kept:${secret}`] }, () => {});
