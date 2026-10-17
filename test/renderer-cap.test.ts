import { describe, expect, it } from 'vitest';
import { CAP_STEP, cappedLength, resultSummary } from '../src/renderer/filters/cap.js';

describe('cappedLength', () => {
  it('never renders more than the cap or the matching tests', () => {
    expect(cappedLength(4200, CAP_STEP)).toBe(500);
    expect(cappedLength(120, CAP_STEP)).toBe(120);
    expect(cappedLength(4200, 1000)).toBe(1000);
    expect(cappedLength(10, -1)).toBe(0);
  });
});

describe('resultSummary', () => {
  it('says how many tests match when every match is shown', () => {
    expect(resultSummary(340, 340, 340)).toBe('340 tests');
    expect(resultSummary(12, 12, 340)).toBe('12 of 340 tests');
    expect(resultSummary(1, 1, 1)).toBe('1 test');
  });

  it('mentions the cap, with thousands separators', () => {
    expect(resultSummary(500, 5000, 5000)).toBe('Showing 500 of 5,000 tests');
    expect(resultSummary(500, 4200, 5000)).toBe('Showing 500 of 4,200 matching tests (5,000 in total)');
  });
});
