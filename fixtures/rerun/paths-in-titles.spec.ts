import { homedir } from 'node:os';
import path from 'node:path';
import { test } from '@playwright/test';

// Titles keep their paths in the report, but for a home directory, which becomes
// `~`. The root comes from the config: this file also runs from the Windows
// check's copy.
const root = process.env['LOUPE_FIXTURE_RERUN_ROOT'] ?? '';
const body = async () => {};

test(`reads ${path.join(root, 'data', 'a.json')}`, body);
test(`reads ${path.join(homedir(), 'other', 'a.json')}`, body);
test(`reads ${path.join(root, 'decoy.json')}`, body);
// What the test above would read like, were its path made relative.
test('reads decoy.json', body);
