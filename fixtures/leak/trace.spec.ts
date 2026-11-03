import { test } from '@playwright/test';

// A trace attachment, so `traceViewer: 'bundled'` copies the viewer in this browserless suite.

test('has a trace', async ({}, testInfo) => {
  await testInfo.attach('trace', { body: 'not a real trace', contentType: 'application/zip' });
});
