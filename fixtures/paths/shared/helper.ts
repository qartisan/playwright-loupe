import { expect } from '@playwright/test';

/** A helper outside `testDir`, failing on purpose: its frame is outside the root dir. */
export function expectTwo(value: number): void {
  expect(value, 'shared helper').toBe(2);
}
