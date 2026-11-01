import { expect, test } from '@playwright/test';
import { HOMES } from './homes.js';

// A home directory in every place a report can hold one. Failures are intentional
// (see fixtures/README.md). Their stacks point here, so this file holds no home.

for (const home of HOMES) {
  test.describe(`group ${home}`, () => {
    test(`reads ${home}`, { annotation: { type: 'written', description: home }, tag: `@reads:${home}` }, async ({}, testInfo) => {
      console.log(`stdout ${home}`);
      console.error(`stderr ${home}`);
      testInfo.annotations.push({ type: 'pushed', description: home });
      await testInfo.attach(`inline ${home}`, { body: `body ${home}`, contentType: 'text/plain' });
      await testInfo.attach(`file ${home}`, { body: 'x'.repeat(5000), contentType: 'text/plain' });
      await testInfo.attach(`other ${home}`, { body: 'y'.repeat(5000), contentType: 'text/plain' });
      await test.step(`step ${home}`, async () => {
        expect.soft(home, `custom ${home}`).toBe('another value');
        const error = new Error(`message ${home}`);
        error.stack = `${error.stack}\n    at reads (${home}:1:1)`;
        throw error;
      });
    });
  });
}
