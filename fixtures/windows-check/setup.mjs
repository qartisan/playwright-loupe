// Creates the test files with difficult names: from here, not from the archive,
// because tar on Windows can mangle non-ASCII names. The `%` one is only here:
// Playwright crashes on it in ES module packages, and this package is CommonJS.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const dir = path.join('rerun', 'hostile', '[id]', '(group)');
mkdirSync(dir, { recursive: true });
const body = (title) => `import { test } from '@playwright/test';\n\ntest('${title}', async () => {});\ntest('alpha', async () => {});\n`;
writeFileSync(path.join(dir, 'a+b c.spec.ts'), body('in a path with regex characters'));
writeFileSync(path.join(dir, "$a !c &d 'e' ^f `g` \u00e9.spec.ts"), body('in a path with shell characters'));
writeFileSync(path.join(dir, '$a %b% c.spec.ts'), body('in a path with a percent sign'));
console.log(`Created 3 files in ${dir}`);
