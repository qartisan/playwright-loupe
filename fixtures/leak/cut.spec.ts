import { test } from '@playwright/test';
import { ACROSS_CUT, acrossCut } from './homes.js';

// Outputs longer than what the report keeps, each with a secret or a home running across the cut:
// masked before the cut, none shows, not even in part. Pass.

for (const [index, { stream, value, word }] of ACROSS_CUT.entries()) {
  test(`writes a long ${stream} with value ${index} across the cut`, () => {
    process[stream].write(acrossCut(value, word));
  });
}
