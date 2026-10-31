import { homedir } from 'node:os';
import path from 'node:path';
import { test } from '@playwright/test';

// Loupe rewrites absolute paths under the root or home directory in every string
// of the report, titles included, so no command can match these real titles: it
// finds nothing, unless another test really has the rewritten title. The root
// comes from the config: this file also runs from the Windows check's copy.
const root = process.env['LOUPE_FIXTURE_RERUN_ROOT'] ?? '';
const body = async () => {};

test(`reads ${path.join(root, 'data', 'a.json')}`, body);
test(`reads ${path.join(homedir(), 'other', 'a.json')}`, body);
test(`reads ${path.join(root, 'decoy.json')}`, body);
// What the report calls the test above: its command selects this one.
test('reads decoy.json', body);
